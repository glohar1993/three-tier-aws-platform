import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class NetworkStack extends cdk.Stack {
  // Expose these so other stacks can reference them
  public readonly vpc: ec2.Vpc;
  public readonly albSg: ec2.SecurityGroup;   // Tier 1: ALB security group
  public readonly appSg: ec2.SecurityGroup;   // Tier 2: EC2 app security group
  public readonly dbSg: ec2.SecurityGroup;    // Tier 3: RDS security group

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // STEP 2A — VPC
    // =========================================================================
    // WHY: A VPC is a logically isolated section of AWS. Think of it as your
    // own private data center in the cloud. Nothing outside can reach resources
    // inside unless you explicitly allow it.
    //
    // WHAT IT CREATES:
    //   - 3 PUBLIC subnets  (one per AZ) — for the ALB
    //   - 3 PRIVATE subnets (one per AZ) — for EC2 app servers
    //   - 3 ISOLATED subnets(one per AZ) — for RDS (no internet at all)
    //   - 1 Internet Gateway  — allows public subnets to reach the internet
    //   - 3 NAT Gateways      — allow private subnets to make outbound calls
    //     (e.g. to download software) without being reachable from the internet
    this.vpc = new ec2.Vpc(this, 'AppVpc', {
      vpcName: 'three-tier-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 3,
      natGateways: 3, // one per AZ for high availability — if one AZ goes down, others still have egress
      subnetConfiguration: [
        {
          // Tier 1: internet-facing — only the ALB lives here
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false, // EC2 instances never get public IPs
        },
        {
          // Tier 2: app servers — can call out (via NAT), cannot be reached from internet
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          // Tier 3: database — completely isolated, zero internet route
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // =========================================================================
    // STEP 2B — VPC FLOW LOGS
    // =========================================================================
    // WHY: Records all IP traffic flowing through your VPC. Required for
    // production security auditing and troubleshooting connectivity issues.
    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogs', {
      logGroupName: '/aws/vpc/three-tier-flow-logs',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // =========================================================================
    // STEP 2C — SECURITY GROUPS (the key to 3-tier isolation)
    // =========================================================================
    // WHY: Security Groups are stateful firewalls at the resource level.
    // The golden rule of 3-tier: each SG only accepts traffic from the
    // SG directly above it. No bypassing tiers.

    // --- ALB Security Group (Tier 1) ---
    // Accepts HTTP from anywhere on the internet
    this.albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'three-tier-alb-sg',
      description: 'Tier 1: Allow HTTP inbound from internet to ALB',
      allowAllOutbound: true,
    });
    this.albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet',
    );

    // --- App Security Group (Tier 2) ---
    // Accepts traffic ONLY from the ALB SG — EC2 is never directly reachable
    this.appSg = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'three-tier-app-sg',
      description: 'Tier 2: Allow traffic only from ALB',
      allowAllOutbound: true,
    });
    this.appSg.addIngressRule(
      ec2.Peer.securityGroupId(this.albSg.securityGroupId),
      ec2.Port.tcp(8080),
      'Allow traffic from ALB only',
    );

    // --- Database Security Group (Tier 3) ---
    // Accepts MySQL ONLY from the App SG — DB is completely hidden from internet
    this.dbSg = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'three-tier-db-sg',
      description: 'Tier 3: Allow MySQL only from App tier',
      allowAllOutbound: false, // DB never needs to initiate outbound
    });
    this.dbSg.addIngressRule(
      ec2.Peer.securityGroupId(this.appSg.securityGroupId),
      ec2.Port.tcp(3306),
      'Allow MySQL from App tier only',
    );

    // =========================================================================
    // OUTPUTS — printed after `cdk deploy` so you know what was created
    // =========================================================================
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: 'ThreeTierVpcId',
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
    });
  }
}
