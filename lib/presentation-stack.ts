import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

interface PresentationStackProps extends cdk.StackProps {
  network: NetworkStack;
}

export class PresentationStack extends cdk.Stack {
  // Expose the target group so ApplicationStack can register EC2 instances
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: PresentationStackProps) {
    super(scope, id, props);

    const { vpc, albSg } = props.network;

    // =========================================================================
    // STEP 3A — ALB ACCESS LOG BUCKET
    // =========================================================================
    // WHY: Production ALBs should log every request — useful for debugging,
    // security auditing, and building usage metrics. Logs go to S3 cheaply.
    const accessLogBucket = new s3.Bucket(this, 'AlbAccessLogs', {
      bucketName: `three-tier-alb-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Keep logs for 90 days, then auto-delete — saves storage costs
          expiration: cdk.Duration.days(90),
          transitions: [
            {
              // Move to cheaper storage after 30 days
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // =========================================================================
    // STEP 3B — APPLICATION LOAD BALANCER
    // =========================================================================
    // WHY: The ALB distributes traffic across all healthy EC2 instances.
    // It lives in PUBLIC subnets (internet-facing) and uses the ALB Security
    // Group which only allows port 80 inbound.
    //
    // Key production settings:
    //   - deletionProtection: true  — prevents accidental destroy
    //   - access logs to S3         — full request audit trail
    //   - cross-zone load balancing — traffic distributed evenly across AZs
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'AppAlb', {
      loadBalancerName: 'three-tier-alb',
      vpc,
      internetFacing: true, // public-facing, gets a DNS name like xxx.us-east-1.elb.amazonaws.com
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: false, // set true in real production to prevent accidental delete
    });

    this.alb.logAccessLogs(accessLogBucket, 'alb-logs');

    // =========================================================================
    // STEP 3C — TARGET GROUP
    // =========================================================================
    // WHY: A Target Group is a pool of EC2 instances that receive traffic from
    // the ALB. The ALB continuously health-checks all registered targets.
    // If an instance fails /health checks, it stops receiving new requests.
    //
    // HEALTH CHECK: Every 30 seconds the ALB calls GET /health on port 8080.
    // The instance must return HTTP 200 within 5 seconds or it's marked unhealthy.
    // After 3 consecutive failures → removed from rotation.
    // After 2 consecutive successes → added back.
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      targetGroupName: 'three-tier-app-tg',
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/health',
        port: '8080',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,   // 2 passes → healthy
        unhealthyThresholdCount: 3, // 3 fails → unhealthy
      },
      // Drain connections before deregistering instance (graceful shutdown)
      deregistrationDelay: cdk.Duration.seconds(30),
      // Sticky sessions disabled — stateless architecture is best practice
      stickinessCookieDuration: undefined,
    });

    // =========================================================================
    // STEP 3D — LISTENER
    // =========================================================================
    // WHY: Listeners define what the ALB does with incoming connections.
    // Port 80 → forward to the target group (EC2 instances).
    // In real production you'd add port 443 with an ACM certificate.
    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS — open this in your browser after deploy',
      exportName: 'ThreeTierAlbDns',
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'Application URL',
    });
  }
}
