import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { PresentationStack } from './presentation-stack';

interface ApplicationStackProps extends cdk.StackProps {
  network: NetworkStack;
  presentation: PresentationStack;
}

export class ApplicationStack extends cdk.Stack {
  public readonly asg: autoscaling.AutoScalingGroup;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const { vpc, appSg } = props.network;
    const { targetGroup } = props.presentation;

    // =========================================================================
    // STEP 4A — IAM INSTANCE ROLE
    // =========================================================================
    // WHY: EC2 instances need an IAM role to call AWS services (CloudWatch,
    // Secrets Manager, SSM). Never hardcode AWS credentials on EC2 — always
    // use instance roles. The role assumes permissions via STS automatically.
    //
    // AmazonSSMManagedInstanceCore — enables Systems Manager Session Manager
    // so you can open a shell on the instance without SSH or a bastion host.
    // CloudWatchAgentServerPolicy — allows the CloudWatch agent to push
    // metrics and logs to CloudWatch.
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: 'three-tier-ec2-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Allow EC2 instances to read Secrets Manager (so app can get DB creds)
    instanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:three-tier/*`],
    }));

    // =========================================================================
    // STEP 4B — USER DATA (bootstrap script run on every new instance)
    // =========================================================================
    // WHY: When an EC2 instance launches, user data runs once as root.
    // This installs the app, sets up systemd to keep it running, and
    // configures the CloudWatch agent for log shipping.
    //
    // In production you'd pull your app from S3 or CodeArtifact instead
    // of installing inline — this is simplified for learning purposes.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      // System update
      'dnf update -y',

      // Install Node.js 20 via NodeSource
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'dnf install -y nodejs',

      // Install the CloudWatch agent
      'dnf install -y amazon-cloudwatch-agent',

      // Create the app directory
      'mkdir -p /opt/app',

      // Write package.json for the sample Express app
      `cat > /opt/app/package.json << 'EOF'
{
  "name": "three-tier-app",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "mysql2": "^3.6.0"
  }
}
EOF`,

      // Write the application — a simple Express server
      // /health  → used by ALB health checks
      // /        → main app response
      `cat > /opt/app/server.js << 'APPEOF'
const express = require('express');
const app = express();
const PORT = 8080;

// Middleware
app.use(express.json());

// Health check endpoint — MUST return 200 for ALB to route traffic here
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    instance: process.env.INSTANCE_ID || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Main route
app.get('/', (req, res) => {
  res.json({
    message: 'Three-Tier App — Tier 2 (Application Layer)',
    tier: 'Application',
    instance: process.env.INSTANCE_ID || 'unknown',
    region: process.env.AWS_REGION || 'unknown',
  });
});

// Graceful shutdown — lets ALB drain connections before process exits
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
APPEOF`,

      // Install npm dependencies
      'cd /opt/app && npm install --production',

      // Get instance metadata (for health check response)
      'INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)',
      'AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',

      // Create systemd service so the app restarts if it crashes
      `cat > /etc/systemd/system/three-tier-app.service << 'EOF'
[Unit]
Description=Three-Tier Node.js Application
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/app
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=PORT=8080
EnvironmentFile=-/opt/app/.env

[Install]
WantedBy=multi-user.target
EOF`,

      // Enable and start the app
      'systemctl daemon-reload',
      'systemctl enable three-tier-app',
      'systemctl start three-tier-app',

      // Configure CloudWatch agent to collect app logs
      `cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/three-tier/ec2/system",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "ThreeTier/EC2",
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"]
      },
      "disk": {
        "measurement": ["disk_used_percent"],
        "resources": ["/"]
      }
    }
  }
}
EOF`,

      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json',
    );

    // =========================================================================
    // STEP 4C — LAUNCH TEMPLATE
    // =========================================================================
    // WHY: A Launch Template defines the blueprint for every EC2 instance the
    // ASG creates. All instances are identical — same AMI, type, disk, and role.
    // Using gp3 EBS (not gp2) — better performance at same price.
    // Encrypted EBS — data at rest is encrypted with KMS.
    // IMDSv2 required — prevents SSRF attacks from accessing instance metadata.
    const launchTemplate = new ec2.LaunchTemplate(this, 'AppLaunchTemplate', {
      launchTemplateName: 'three-tier-app-lt',
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      securityGroup: appSg,
      role: instanceRole,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      // IMDSv2 — tokens required, hop limit 1 (only the instance itself, not containers)
      requireImdsv2: true,
      httpPutResponseHopLimit: 1,
      // Detailed monitoring — 1-minute CloudWatch metrics instead of 5-minute
      detailedMonitoring: true,
    });

    // =========================================================================
    // STEP 4D — AUTO SCALING GROUP
    // =========================================================================
    // WHY: The ASG ensures you always have healthy instances running.
    // - minCapacity: 2 → never go below 2 (one per AZ for HA)
    // - maxCapacity: 6 → cap cost at 6 instances under high load
    // - HealthCheck.elb → uses ALB health checks (not just EC2 status)
    //   This is critical: if your app crashes but EC2 is up, ELB health
    //   check catches it and replaces the instance.
    this.asg = new autoscaling.AutoScalingGroup(this, 'AppAsg', {
      autoScalingGroupName: 'three-tier-app-asg',
      vpc,
      launchTemplate,
      minCapacity: 2,
      desiredCapacity: 2,
      maxCapacity: 6,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // ELB health check — ALB probes /health; if it fails 3x, ASG replaces the instance
      healthCheck: autoscaling.HealthCheck.elb({
        grace: cdk.Duration.minutes(5), // 5 min grace: don't kill instance while it's still booting
      }),
      // Spread instances evenly across AZs
      // If one AZ goes down, remaining AZs still serve traffic
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        minInstancesInService: 1, // keep at least 1 running during deployments
        maxBatchSize: 1,          // replace 1 instance at a time
        pauseTime: cdk.Duration.minutes(5),
      }),
      notifications: [], // add SNS topic here in production for scale events
    });

    // Register the ASG with the ALB target group
    // This tells the ALB to send traffic to instances in this ASG
    this.asg.attachToApplicationTargetGroup(targetGroup);

    // =========================================================================
    // STEP 4E — AUTO SCALING POLICY
    // =========================================================================
    // WHY: Target Tracking automatically adjusts instance count to keep
    // average CPU at 60%. If load spikes, new instances launch within ~3 min.
    // If load drops, instances are terminated (scale-in cooldown: 5 min).
    this.asg.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      cooldown: cdk.Duration.minutes(5),
    });

    // =========================================================================
    // STEP 4F — CLOUDWATCH ALARMS
    // =========================================================================
    // WHY: Alerts when something goes wrong in production.
    // These alarms would typically trigger SNS → email/PagerDuty.

    // Alarm: too few healthy instances (< 2 is dangerous for HA)
    new cloudwatch.Alarm(this, 'LowInstanceCount', {
      alarmName: 'ThreeTier-LowInstanceCount',
      alarmDescription: 'ASG has fewer than 2 in-service instances',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/AutoScaling',
        metricName: 'GroupInServiceInstances',
        dimensionsMap: {
          AutoScalingGroupName: this.asg.autoScalingGroupName,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Minimum',
      }),
      threshold: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================
    new cdk.CfnOutput(this, 'AsgName', {
      value: this.asg.autoScalingGroupName,
      description: 'Auto Scaling Group name',
    });

    new cdk.CfnOutput(this, 'SsmConnectHint', {
      value: `aws ssm start-session --target <instance-id> --region ${this.region}`,
      description: 'Use this command to connect to an EC2 instance (no SSH needed)',
    });
  }
}
