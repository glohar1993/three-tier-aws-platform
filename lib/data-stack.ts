import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

interface DataStackProps extends cdk.StackProps {
  network: NetworkStack;
}

export class DataStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { vpc, dbSg } = props.network;

    // =========================================================================
    // STEP 5A — SECRETS MANAGER (credentials — never hardcode passwords!)
    // =========================================================================
    // WHY: Secrets Manager stores the DB password encrypted with KMS.
    // Your app calls GetSecretValue at runtime — the password never appears
    // in source code, environment variables, or CloudFormation templates.
    //
    // The secret is auto-generated as JSON: { "username": "admin", "password": "..." }
    // EC2 instances fetch this via the IAM role we attached in ApplicationStack.
    this.dbSecret = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: 'three-tier/db/credentials',
      description: 'MySQL admin credentials for three-tier app',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludePunctuation: true, // MySQL passwords work better without special chars
        passwordLength: 32,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // change to RETAIN in real production
    });

    // =========================================================================
    // STEP 5B — DB SUBNET GROUP
    // =========================================================================
    // WHY: Tells RDS which subnets it can place instances in.
    // We use ISOLATED subnets — no NAT Gateway, no internet gateway route.
    // The DB is completely unreachable from outside the VPC.
    const subnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      description: 'Isolated subnets for RDS MySQL',
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      subnetGroupName: 'three-tier-db-subnet-group',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // STEP 5C — RDS PARAMETER GROUP
    // =========================================================================
    // WHY: Parameter groups tune MySQL engine settings.
    // These settings improve performance and security for production:
    //   - slow_query_log: capture queries taking > 1 second
    //   - general_log: disabled in prod (too verbose)
    //   - max_connections: explicitly managed
    const parameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      description: 'Production MySQL 8.0 parameter group',
      parameters: {
        slow_query_log: '1',
        long_query_time: '1',     // log queries slower than 1 second
        log_output: 'FILE',
        general_log: '0',         // off in production
        max_connections: '200',
        character_set_server: 'utf8mb4',
        collation_server: 'utf8mb4_unicode_ci',
      },
    });

    // =========================================================================
    // STEP 5D — RDS MYSQL INSTANCE
    // =========================================================================
    // WHY: This is the actual database. Key production settings explained:
    //
    //   multiAz: true
    //     → AWS maintains a synchronous standby replica in a different AZ.
    //       On failure, RDS auto-promotes standby → failover in ~60 seconds.
    //       Application reconnects automatically via the same endpoint.
    //
    //   storageEncrypted: true
    //     → EBS volumes encrypted with AWS KMS. Compliance requirement for
    //       most standards (SOC2, HIPAA, PCI-DSS).
    //
    //   backupRetention: 7 days
    //     → Automated daily snapshots. Can restore to any point-in-time
    //       within the last 7 days.
    //
    //   deletionProtection: true
    //     → Prevents accidental deletion via CloudFormation or console.
    //       You must explicitly disable it before deleting.
    //
    //   storageType: GP3
    //     → Newer than GP2. Better baseline IOPS (3000 free), lower cost.
    //       Auto-scaling grows storage without downtime.
    this.dbInstance = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: 'three-tier-mysql',
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM,
      ),
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      vpc,
      securityGroups: [dbSg],
      subnetGroup,
      parameterGroup,
      multiAz: true,
      storageEncrypted: true,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 100, // auto-grow up to 100 GB if needed
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: '03:00-04:00',    // 3-4am UTC (low traffic)
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00', // Sunday 4am UTC
      deletionProtection: false, // set true in real production
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enablePerformanceInsights: true,        // query-level performance analysis
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT, // 7 days free
      cloudwatchLogsExports: ['error', 'slowquery'], // ship slow query + error logs to CW
      cloudwatchLogsRetention: cdk.Duration.days(30).toDays(),
      autoMinorVersionUpgrade: true,  // auto-apply MySQL patch releases
      publiclyAccessible: false,      // NEVER make this true in production
      databaseName: 'appdb',
    });

    // =========================================================================
    // STEP 5E — CLOUDWATCH ALARMS FOR DATABASE
    // =========================================================================
    // WHY: Proactive alerting before the database becomes a bottleneck.

    // High CPU on RDS → slow queries, potential for connection pool exhaustion
    new cloudwatch.Alarm(this, 'DbHighCpu', {
      alarmName: 'ThreeTier-RDS-HighCPU',
      alarmDescription: 'RDS CPU > 80% for 10 minutes',
      metric: this.dbInstance.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // Low free storage → database will stop accepting writes if storage fills
    new cloudwatch.Alarm(this, 'DbLowStorage', {
      alarmName: 'ThreeTier-RDS-LowFreeStorage',
      alarmDescription: 'RDS free storage < 2 GB',
      metric: this.dbInstance.metricFreeStorageSpace({
        period: cdk.Duration.minutes(5),
        statistic: 'Minimum',
      }),
      threshold: 2 * 1024 * 1024 * 1024, // 2 GB in bytes
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });

    // High DB connections → app may be connection-leaking or under heavy load
    new cloudwatch.Alarm(this, 'DbHighConnections', {
      alarmName: 'ThreeTier-RDS-HighConnections',
      alarmDescription: 'RDS connections > 150 (limit is 200)',
      metric: this.dbInstance.metricDatabaseConnections({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 150,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbInstance.dbInstanceEndpointAddress,
      description: 'RDS endpoint (use this in your app config)',
      exportName: 'ThreeTierDbEndpoint',
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: this.dbInstance.dbInstanceEndpointPort,
      description: 'RDS port',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.dbSecret.secretArn,
      description: 'Secrets Manager ARN — fetch DB credentials from here',
      exportName: 'ThreeTierDbSecretArn',
    });

    new cdk.CfnOutput(this, 'HowToGetDbPassword', {
      value: `aws secretsmanager get-secret-value --secret-id three-tier/db/credentials --region ${this.region}`,
      description: 'Command to retrieve DB credentials',
    });
  }
}
