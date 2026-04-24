# AWS CDK Complete Concepts Guide
## TypeScript Edition — From Zero to Production

---

## Table of Contents
1. [What is a Construct?](#1-what-is-a-construct)
2. [L1 Constructs — CFN Resources](#2-l1-constructs--cfn-resources-lowest-level)
3. [L2 Constructs — AWS Constructs](#3-l2-constructs--aws-constructs-what-we-used)
4. [L3 Constructs — Patterns](#4-l3-constructs--patterns-highest-level)
5. [L1 vs L2 vs L3 — Side by Side](#5-l1-vs-l2-vs-l3--side-by-side-comparison)
6. [App & Stack](#6-app--stack)
7. [Props & Interfaces](#7-props--interfaces)
8. [Tokens & References](#8-tokens--references)
9. [Outputs & Exports](#9-outputs--exports)
10. [Context & Environment](#10-context--environment)
11. [Assets](#11-assets)
12. [Custom Resources](#12-custom-resources)
13. [Aspects](#13-aspects)
14. [Tags](#14-tags)
15. [Removal Policies](#15-removal-policies)
16. [Stack Dependencies](#16-stack-dependencies)
17. [Escape Hatches](#17-escape-hatches)
18. [CDK Pipelines](#18-cdk-pipelines)
19. [Testing CDK Code](#19-testing-cdk-code)
20. [CDK CLI Commands Cheatsheet](#20-cdk-cli-commands-cheatsheet)

---

## 1. What is a Construct?

A **Construct** is the basic building block of CDK. Everything in CDK is a construct.

Think of constructs like **LEGO bricks**:
- Small bricks = L1 (raw pieces)
- Pre-assembled sections = L2 (useful shapes)
- Complete models = L3 (entire finished sets)

```
Every construct has:
  - A scope  (where does it live? — parent construct)
  - An id    (unique name within its parent)
  - Props    (configuration options)

new SomeConstruct(scope, id, props)
       │            │     │     │
       │            │     │     └── { config options }
       │            │     └──────── 'MyUniqueId'
       │            └────────────── this  (parent)
       └─────────────────────────── The construct class
```

### The Construct Tree:
```
App
 └── Stack (NetworkStack)
      └── VPC (AppVpc)
           ├── Subnet (PublicSubnet1)
           │    └── RouteTable
           └── Subnet (PrivateSubnet1)
                └── RouteTable
```
Every construct has a parent except App (the root).

---

## 2. L1 Constructs — CFN Resources (Lowest Level)

**L1 = Level 1 = CloudFormation Resources**

L1 constructs are **direct 1:1 mappings** to CloudFormation resource types.
They always start with `Cfn` prefix.

### Key facts:
- Auto-generated from CloudFormation spec
- Full control over every property
- No opinions — you set everything manually
- Verbose — need to know CloudFormation internals
- Use when L2 doesn't expose what you need

### Example — Creating an S3 Bucket with L1:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

// L1 — CfnBucket (raw CloudFormation)
const cfnBucket = new s3.CfnBucket(this, 'MyL1Bucket', {
  // Every property maps directly to CloudFormation YAML
  bucketName: 'my-l1-bucket',
  versioningConfiguration: {
    status: 'Enabled',
  },
  bucketEncryption: {
    serverSideEncryptionConfiguration: [
      {
        serverSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  },
  publicAccessBlockConfiguration: {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
  tags: [
    { key: 'Environment', value: 'Production' },
  ],
});
```

This is **identical** to writing this CloudFormation YAML:
```yaml
MyL1Bucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: my-l1-bucket
    VersioningConfiguration:
      Status: Enabled
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault:
            SSEAlgorithm: AES256
```

### L1 Example — Security Group (what we used in our project):
```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// L1 way — very manual
const cfnSg = new ec2.CfnSecurityGroup(this, 'MyL1Sg', {
  groupDescription: 'My security group',
  vpcId: 'vpc-12345',
  securityGroupIngress: [
    {
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      cidrIp: '0.0.0.0/0',
    },
  ],
});
```

### When to use L1:
- AWS just released a new feature — L2 hasn't been updated yet
- You need a CloudFormation property that L2 doesn't expose
- You're migrating existing CloudFormation templates to CDK

---

## 3. L2 Constructs — AWS Constructs (What We Used!)

**L2 = Level 2 = Higher-level abstractions with sensible defaults**

L2 constructs are **what you use 90% of the time**. They:
- Have intelligent defaults
- Include helper methods
- Handle IAM permissions automatically
- Are much less verbose than L1
- Use TypeScript types for safety

### Example — Same S3 Bucket with L2:

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';

// L2 — Bucket (smart defaults built in)
const bucket = new s3.Bucket(this, 'MyL2Bucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,    // one line vs 8 lines in L1
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // preset constant
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// L2 adds HELPER METHODS — L1 has none of these:
bucket.grantRead(someRole);       // auto-creates IAM policy
bucket.grantWrite(anotherRole);   // auto-creates IAM policy
bucket.addLifecycleRule({         // easy lifecycle config
  expiration: cdk.Duration.days(90),
});

// Access the underlying L1 if needed
const cfnBucket = bucket.node.defaultChild as s3.CfnBucket;
cfnBucket.addPropertyOverride('VersioningConfiguration.Status', 'Enabled');
```

### L2 Example — VPC (from our project):
```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// L2 — Vpc (creates dozens of resources automatically)
const vpc = new ec2.Vpc(this, 'AppVpc', {
  maxAzs: 3,
  natGateways: 3,
  subnetConfiguration: [
    { name: 'Public',   subnetType: ec2.SubnetType.PUBLIC,           cidrMask: 24 },
    { name: 'Private',  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
    { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
  ],
});

// L2 helper methods on VPC:
vpc.addFlowLog('FlowLog');                        // enables VPC flow logs
vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }); // filter subnets
vpc.addGatewayEndpoint('S3Endpoint', {            // adds VPC endpoint for S3
  service: ec2.GatewayVpcEndpointAwsService.S3,
});
```

### L2 Example — RDS (from our project):
```typescript
import * as rds from 'aws-cdk-lib/aws-rds';

// L2 handles: subnet groups, parameter groups, option groups,
//             security group rules, credential rotation, monitoring
const db = new rds.DatabaseInstance(this, 'Database', {
  engine: rds.DatabaseInstanceEngine.mysql({
    version: rds.MysqlEngineVersion.VER_8_0,
  }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
  vpc,
  multiAz: true,
  storageEncrypted: true,
  backupRetention: cdk.Duration.days(7),
});

// L2 helper methods:
db.connections.allowFrom(appSg, ec2.Port.tcp(3306)); // auto security group rule
db.grantConnect(instanceRole);                        // auto IAM permission
db.metricCPUUtilization();                           // pre-built CloudWatch metric
```

### L2 Grant Methods (the killer feature):
```typescript
// L2 automatically creates the correct IAM policy for you
bucket.grantRead(role);              // s3:GetObject, s3:ListBucket
bucket.grantWrite(role);             // s3:PutObject, s3:DeleteObject
bucket.grantReadWrite(role);         // both
table.grantReadData(role);           // dynamodb:GetItem, dynamodb:Query...
table.grantWriteData(role);          // dynamodb:PutItem, dynamodb:UpdateItem...
queue.grantSendMessages(role);       // sqs:SendMessage
topic.grantPublish(role);            // sns:Publish
secret.grantRead(role);              // secretsmanager:GetSecretValue
```

---

## 4. L3 Constructs — Patterns (Highest Level)

**L3 = Level 3 = Complete patterns / solutions**

L3 constructs combine multiple L2 constructs into a **complete, opinionated solution**.
One L3 can create dozens of AWS resources.

Also called **"AWS Solutions Constructs"** or **"CDK Patterns"**.

### Example — Static Website with L3:
```typescript
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

// L3 pattern: S3 + CloudFront + deployment in ~10 lines
// Creates: S3 bucket, CloudFront distribution, OAI, bucket policy, deployment
const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
  websiteIndexDocument: 'index.html',
});

const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(websiteBucket), // L3 origin
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
});

// Deploy local files to S3 + invalidate CloudFront cache
new s3deploy.BucketDeployment(this, 'DeployWebsite', {
  sources: [s3deploy.Source.asset('./website-dist')],
  destinationBucket: websiteBucket,
  distribution,                              // auto-invalidates cache on deploy
  distributionPaths: ['/*'],
});
```

### Example — ECS Fargate Service with L3 (ApplicationLoadBalancedFargateService):
```typescript
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecs from 'aws-cdk-lib/aws-ecs';

// ONE construct creates: ECS Cluster, Task Definition, Fargate Service,
//                        ALB, Target Group, Listener, Security Groups,
//                        IAM roles, CloudWatch log group
const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
  this,
  'MyFargateService',
  {
    vpc,
    cpu: 256,
    memoryLimitMiB: 512,
    desiredCount: 2,
    taskImageOptions: {
      image: ecs.ContainerImage.fromRegistry('nginx:latest'),
      containerPort: 80,
    },
    publicLoadBalancer: true,
  }
);

// Done! Full production ECS + ALB setup in ~15 lines
console.log(service.loadBalancer.loadBalancerDnsName);
console.log(service.service.serviceName);
```

### Example — Lambda with SQS trigger (L3 EventSource):
```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda_events from 'aws-cdk-lib/aws-lambda-event-sources';

const queue = new sqs.Queue(this, 'MyQueue');

const fn = new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('./lambda'),
});

// L3 event source — sets up trigger + IAM + event source mapping
fn.addEventSource(new lambda_events.SqsEventSource(queue, {
  batchSize: 10,
}));
```

---

## 5. L1 vs L2 vs L3 — Side by Side Comparison

### Creating an SQS Queue — 3 ways:

```typescript
// ─────────────────────────────────────────────────────
// L1 — Raw CloudFormation (verbose, full control)
// ─────────────────────────────────────────────────────
import * as sqs from 'aws-cdk-lib/aws-sqs';

const l1Queue = new sqs.CfnQueue(this, 'L1Queue', {
  queueName: 'my-queue',
  visibilityTimeout: 30,
  messageRetentionPeriod: 345600,   // 4 days in seconds
  kmsMasterKeyId: 'alias/aws/sqs',
  kmsDataKeyReusePeriodSeconds: 300,
  redrivePolicy: {
    deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123:dlq',
    maxReceiveCount: 3,
  },
});
// No helper methods available

// ─────────────────────────────────────────────────────
// L2 — Smart construct (concise, helper methods)
// ─────────────────────────────────────────────────────
const dlq = new sqs.Queue(this, 'DLQ');

const l2Queue = new sqs.Queue(this, 'L2Queue', {
  queueName: 'my-queue',
  visibilityTimeout: cdk.Duration.seconds(30),
  retentionPeriod: cdk.Duration.days(4),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,
  },
});

// Helper methods:
l2Queue.grantSendMessages(producerRole);   // auto IAM
l2Queue.grantConsumeMessages(consumerRole); // auto IAM

// ─────────────────────────────────────────────────────
// L3 — Pattern (opinionated, least code, least control)
// ─────────────────────────────────────────────────────
// No built-in L3 for SQS alone, but combined with Lambda:
import * as lambda_events from 'aws-cdk-lib/aws-lambda-event-sources';

myLambdaFunction.addEventSource(
  new lambda_events.SqsEventSource(l2Queue)
  // Creates: event source mapping, IAM policy, DLQ wiring
);
```

### Decision guide — which level to use:

```
Q: Does L2 exist for what I need?
   └── YES → Use L2 (99% of the time)
   └── NO  → Use L1

Q: Is there an L3 pattern that does exactly what I need?
   └── YES → Use L3 (even less code)
   └── NO  → Build from L2s

Q: L2 exists but missing a property I need?
   └── Use L2, then escape hatch to L1 for that property
```

---

## 6. App & Stack

### App — The Root
```typescript
// bin/app.ts — always the entry point
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();
// App has no AWS resources — it's just the container for stacks
```

### Stack — A Deployable Unit
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// A Stack = one CloudFormation stack = one unit of deployment
export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // All your resources go here
  }
}

// Instantiate in app.ts:
const app = new cdk.App();
new MyStack(app, 'MyStack', {
  env: { account: '123456789', region: 'us-east-1' },
  description: 'My stack description',
  stackName: 'my-custom-cloudformation-name', // optional
  tags: { Project: 'MyApp' },
});
```

### Passing data between stacks:
```typescript
// Stack A produces a value
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;          // expose it publicly

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, 'VPC'); // assign to public field
  }
}

// Stack B consumes it
interface AppStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;  // define in props interface
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { vpc } = props; // use it
    new ec2.SecurityGroup(this, 'SG', { vpc });
  }
}

// Wire them in app.ts:
const network = new NetworkStack(app, 'NetworkStack');
const appStack = new AppStack(app, 'AppStack', { vpc: network.vpc });
appStack.addDependency(network); // ensures NetworkStack deploys first
```

---

## 7. Props & Interfaces

Props are how you configure constructs. In TypeScript, they're just interfaces.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

// Define your own props interface by extending cdk.StackProps
interface WebServerStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;                    // required
  instanceType?: ec2.InstanceType; // optional (has ? mark)
  minInstances?: number;           // optional
}

export class WebServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebServerStackProps) {
    super(scope, id, props);

    const {
      vpc,
      instanceType = ec2.InstanceType.of(  // default value if not provided
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL
      ),
      minInstances = 2,                     // default value
    } = props;

    // use them...
  }
}

// Usage with all props:
new WebServerStack(app, 'WebServer', {
  vpc: myVpc,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
  minInstances: 4,
  env: { account: '123', region: 'us-east-1' },
});

// Usage with just required props (optional ones use defaults):
new WebServerStack(app, 'WebServer', {
  vpc: myVpc,
  env: { account: '123', region: 'us-east-1' },
});
```

---

## 8. Tokens & References

**The most important CDK concept to understand.**

When you write CDK code, AWS resources don't exist yet. CDK uses **Tokens** as placeholders for values that will only be known at deploy time.

```typescript
const bucket = new s3.Bucket(this, 'Bucket');

// This is NOT a real string yet — it's a Token
// At synth time: "${Token[TOKEN.123]}"
// At deploy time: "my-actual-bucket-name-abc123"
console.log(bucket.bucketName);

// WRONG — don't do this:
if (bucket.bucketName === 'my-bucket') { ... }  // always false! It's a token

// RIGHT — pass the token as-is to other constructs:
new lambda.Function(this, 'Fn', {
  environment: {
    BUCKET_NAME: bucket.bucketName,  // CDK resolves this at deploy time
  },
});

// RIGHT — use Token.isUnresolved() to check:
import { Token } from 'aws-cdk-lib';
console.log(Token.isUnresolved(bucket.bucketName)); // true
```

### Cross-stack references (automatic tokens):
```typescript
// Stack A
export class NetworkStack extends cdk.Stack {
  public readonly vpcId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const vpc = new ec2.Vpc(this, 'VPC');
    this.vpcId = vpc.vpcId; // This is a Token
  }
}

// Stack B uses it
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: { vpcId: string } & cdk.StackProps) {
    super(scope, id, props);
    // CDK automatically creates a CloudFormation Export/Import for this
    // The vpcId token resolves to the real VPC ID at deploy time
    console.log(props.vpcId); // "${Token[TOKEN.456]}" during synth
  }
}
```

---

## 9. Outputs & Exports

Outputs are values printed after `cdk deploy` — useful for sharing info between stacks or with users.

```typescript
// Basic output — printed after deploy
new cdk.CfnOutput(this, 'BucketUrl', {
  value: bucket.bucketWebsiteUrl,
  description: 'Website URL',
});

// Named export — other stacks can import this value
new cdk.CfnOutput(this, 'VpcId', {
  value: vpc.vpcId,
  exportName: 'MyApp-VpcId',         // CloudFormation export name
});

// In another stack, import it:
const importedVpcId = cdk.Fn.importValue('MyApp-VpcId');
```

### Save outputs to a file:
```bash
npx cdk deploy --outputs-file outputs.json
cat outputs.json
# {
#   "MyStack": {
#     "BucketUrl": "http://my-bucket.s3-website-us-east-1.amazonaws.com",
#     "VpcId": "vpc-0abc12345"
#   }
# }
```

---

## 10. Context & Environment

### Environment — which account and region:
```typescript
// Explicit (recommended for production):
new MyStack(app, 'ProdStack', {
  env: {
    account: '123456789012',
    region: 'us-east-1',
  },
});

// From environment variables (CI/CD):
new MyStack(app, 'ProdStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Unresolved (less safe — works on any account):
new MyStack(app, 'AnyStack');
```

### Context — key/value config passed to CDK:
```typescript
// Set in cdk.json:
// { "context": { "environment": "prod", "instanceType": "t3.large" } }

// Read in your code:
const env = this.node.tryGetContext('environment') ?? 'dev';
const instanceType = this.node.tryGetContext('instanceType') ?? 't3.small';

// Pass via CLI:
// npx cdk deploy --context environment=prod --context instanceType=t3.large
```

---

## 11. Assets

Assets are local files (code, Docker images) that CDK uploads to S3 or ECR automatically.

### File Assets — upload local code to S3:
```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';

// CDK automatically:
//   1. Zips the ./lambda-code folder
//   2. Uploads it to the CDK bootstrap S3 bucket
//   3. References it in the Lambda function
const fn = new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('./lambda-code'),  // local folder → S3
});

// Other asset sources:
lambda.Code.fromAsset('./my-function.zip')           // zip file
lambda.Code.fromBucket(bucket, 'my-code.zip')        // existing S3 object
lambda.Code.fromInline('exports.handler = ...')       // inline code (< 4KB)
```

### Docker Image Assets — build and push to ECR:
```typescript
import * as ecs from 'aws-cdk-lib/aws-ecs';

// CDK automatically:
//   1. Builds the Docker image from ./app/Dockerfile
//   2. Pushes it to ECR
//   3. Uses the ECR URI in the task definition
const taskDef = new ecs.FargateTaskDefinition(this, 'Task');
taskDef.addContainer('App', {
  image: ecs.ContainerImage.fromAsset('./app'),  // local Dockerfile → ECR
  memoryLimitMiB: 512,
});
```

---

## 12. Custom Resources

When AWS doesn't have a CloudFormation resource for something, use a **Custom Resource** — a Lambda function that runs during deploy.

```typescript
import * as cr from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// Example: Send a Slack notification when your stack deploys
const notifyFn = new lambda.Function(this, 'NotifyFn', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromInline(`
    exports.handler = async (event) => {
      console.log('Stack deployed!', event.RequestType);
      // call Slack API here
      return { PhysicalResourceId: 'notify' };
    };
  `),
});

// Custom resource triggers the Lambda on Create/Update/Delete
new cdk.CustomResource(this, 'DeployNotification', {
  serviceToken: notifyFn.functionArn,
  properties: {
    Message: 'Stack deployed successfully!',
    Timestamp: Date.now().toString(),
  },
});

// Built-in AwsCustomResource — call any AWS API during deploy:
const getParam = new cr.AwsCustomResource(this, 'GetParam', {
  onUpdate: {
    service: 'SSM',
    action: 'getParameter',
    parameters: { Name: '/my/param' },
    physicalResourceId: cr.PhysicalResourceId.of('my-param'),
  },
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
    resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
  }),
});

const paramValue = getParam.getResponseField('Parameter.Value');
```

---

## 13. Aspects

**Aspects** let you visit every construct in a tree and apply changes. Perfect for enforcing policies across all resources.

```typescript
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

// Example: Force encryption on every S3 bucket in the entire app
class EnforceS3Encryption implements cdk.IAspect {
  visit(node: IConstruct): void {
    if (node instanceof s3.CfnBucket) {
      // Add encryption if missing
      node.bucketEncryption = {
        serverSideEncryptionConfiguration: [{
          serverSideEncryptionByDefault: { sseAlgorithm: 'AES256' },
        }],
      };
    }
  }
}

// Apply to entire app — affects EVERY bucket in EVERY stack
cdk.Aspects.of(app).add(new EnforceS3Encryption());

// Or apply to just one stack:
cdk.Aspects.of(myStack).add(new EnforceS3Encryption());
```

### Practical aspect — add tags to everything:
```typescript
class AddCostTags implements cdk.IAspect {
  constructor(private readonly team: string) {}

  visit(node: IConstruct): void {
    if (cdk.TagManager.isTaggable(node)) {
      cdk.Tags.of(node).add('Team', this.team);
      cdk.Tags.of(node).add('ManagedBy', 'CDK');
    }
  }
}

cdk.Aspects.of(app).add(new AddCostTags('platform-team'));
```

---

## 14. Tags

Add metadata to every AWS resource — useful for cost tracking, filtering in console.

```typescript
// Tag a single resource:
const bucket = new s3.Bucket(this, 'Bucket');
cdk.Tags.of(bucket).add('Environment', 'Production');
cdk.Tags.of(bucket).add('Team', 'Backend');

// Tag an entire stack (all resources inside get the tag):
cdk.Tags.of(this).add('Project', 'ThreeTierApp');

// Tag the entire app (all stacks + all resources):
cdk.Tags.of(app).add('ManagedBy', 'CDK');

// Remove a tag:
cdk.Tags.of(bucket).remove('SomeTag');

// In props (recommended — applies to whole stack):
new MyStack(app, 'MyStack', {
  tags: {
    Environment: 'prod',
    Project: 'MyApp',
    Owner: 'platform-team',
  },
});
```

---

## 15. Removal Policies

What happens to a resource when you run `cdk destroy` or remove it from your code?

```typescript
import * as cdk from 'aws-cdk-lib';

// DESTROY — delete the resource (default for most stateless resources)
new s3.Bucket(this, 'TempBucket', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true, // needed for non-empty buckets
});

// RETAIN — keep the resource even after stack is deleted (default for RDS, S3)
// Use this for production databases — never accidentally delete data
new rds.DatabaseInstance(this, 'ProdDB', {
  // ...
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  deletionProtection: true,
});

// SNAPSHOT — take a snapshot before deleting (RDS, ElastiCache)
new rds.DatabaseInstance(this, 'DB', {
  // ...
  removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
});
```

### When to use each:
| Policy | Use For |
|---|---|
| `DESTROY` | Dev/test resources, temp buckets, log groups |
| `RETAIN` | Production databases, critical S3 buckets |
| `SNAPSHOT` | Production RDS when you want a backup on delete |

---

## 16. Stack Dependencies

Control the order stacks are deployed.

```typescript
const network = new NetworkStack(app, 'NetworkStack');
const database = new DatabaseStack(app, 'DatabaseStack');
const app_   = new ApplicationStack(app, 'ApplicationStack');

// Explicit dependency — DatabaseStack waits for NetworkStack
database.addDependency(network);

// ApplicationStack waits for BOTH
app_.addDependency(network);
app_.addDependency(database);

// CDK also creates IMPLICIT dependencies automatically
// when you pass a resource from one stack to another:
const dbStack = new DatabaseStack(app, 'DB');
const appStack = new ApplicationStack(app, 'App', {
  dbEndpoint: dbStack.dbEndpoint, // ← CDK automatically makes App depend on DB
});
```

---

## 17. Escape Hatches

When L2 doesn't expose a property you need, access the underlying L1 via escape hatches.

```typescript
// Method 1 — node.defaultChild
const bucket = new s3.Bucket(this, 'Bucket');
const cfnBucket = bucket.node.defaultChild as s3.CfnBucket;

// Now you can set ANY CloudFormation property:
cfnBucket.addPropertyOverride('AccelerateConfiguration.AccelerationStatus', 'Enabled');
cfnBucket.addDeletionOverride('Properties.Tags');  // remove a property

// Method 2 — addPropertyOverride directly
cfnBucket.addPropertyOverride(
  'ReplicationConfiguration.Role',
  'arn:aws:iam::123:role/replication-role'
);

// Method 3 — raw override (use sparingly)
cfnBucket.cfnOptions.metadata = {
  'aws:cdk:path': 'MyStack/Bucket/Resource',
};

// Method 4 — use L1 directly alongside L2
const l2Vpc = new ec2.Vpc(this, 'VPC');
const cfnVpc = l2Vpc.node.defaultChild as ec2.CfnVPC;
cfnVpc.addPropertyOverride('EnableDnsHostnames', true);
```

---

## 18. CDK Pipelines

Automatically deploy your CDK app whenever you push to Git.

```typescript
import * as pipelines from 'aws-cdk-lib/pipelines';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Connect to your GitHub repo
    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'ThreeTierPipeline',
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.gitHub('myorg/myrepo', 'main'),
        commands: [
          'npm ci',
          'npm run build',
          'npx cdk synth',
        ],
      }),
    });

    // Add deployment stages
    pipeline.addStage(new MyAppStage(this, 'Dev', {
      env: { account: '111111111', region: 'us-east-1' },
    }));

    pipeline.addStage(new MyAppStage(this, 'Prod', {
      env: { account: '222222222', region: 'us-east-1' },
    }), {
      // Manual approval required before prod deploy
      pre: [new pipelines.ManualApprovalStep('PromoteToProd')],
    });
  }
}

// A Stage groups stacks that deploy together
class MyAppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    new NetworkStack(this, 'Network');
    new ApplicationStack(this, 'Application');
  }
}
```

---

## 19. Testing CDK Code

CDK has a built-in test library — `aws-cdk-lib/assertions`.

```typescript
// Install: npm install --save-dev jest @types/jest ts-jest
// test/network-stack.test.ts

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';

describe('NetworkStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new NetworkStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('VPC is created with correct CIDR', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
  });

  test('Creates 3 NAT Gateways', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 3);
  });

  test('ALB Security Group allows port 80 from internet', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
          CidrIp: '0.0.0.0/0',
        }),
      ]),
    });
  });

  test('DB Security Group does NOT allow internet access', () => {
    // Snapshot test — detect any unexpected changes
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Tier 3'),
    });
  });

  test('Matches snapshot', () => {
    // First run: creates snapshot file
    // Subsequent runs: fails if anything changed
    expect(template.toJSON()).toMatchSnapshot();
  });
});

// Run tests:
// npx jest
```

---

## 20. CDK CLI Commands Cheatsheet

```bash
# ─────────────────────────────────────────────
# SETUP
# ─────────────────────────────────────────────

# Install CDK globally
npm install -g aws-cdk

# Create new project
cdk init app --language typescript

# One-time bootstrap (per account/region)
cdk bootstrap
cdk bootstrap aws://ACCOUNT/REGION
cdk bootstrap --profile my-aws-profile


# ─────────────────────────────────────────────
# DEVELOPMENT
# ─────────────────────────────────────────────

# Compile TypeScript + watch for changes
npm run build
npm run watch

# Generate CloudFormation templates (no AWS calls)
cdk synth
cdk synth MyStack              # single stack
cdk synth > template.yaml      # save to file

# Show what will change (dry run)
cdk diff
cdk diff --all
cdk diff MyStack

# List all stacks
cdk list
cdk ls


# ─────────────────────────────────────────────
# DEPLOYMENT
# ─────────────────────────────────────────────

# Deploy
cdk deploy
cdk deploy --all
cdk deploy MyStack
cdk deploy Stack1 Stack2        # multiple stacks

# Deploy without approval prompt
cdk deploy --all --require-approval never

# Deploy and save outputs to file
cdk deploy --all --outputs-file outputs.json

# Deploy with context values
cdk deploy --context environment=prod

# Deploy with specific AWS profile
cdk deploy --profile my-profile

# Deploy with role assumption
cdk deploy --role-arn arn:aws:iam::ACCOUNT:role/DeployRole


# ─────────────────────────────────────────────
# DESTROY
# ─────────────────────────────────────────────

# Delete all stacks (careful!)
cdk destroy --all
cdk destroy --all --force       # no confirmation prompt
cdk destroy MyStack


# ─────────────────────────────────────────────
# DEBUGGING
# ─────────────────────────────────────────────

# Verbose output
cdk deploy --verbose
cdk deploy --debug

# Show CloudFormation events during deploy
cdk deploy --progress events

# Print CloudFormation template as JSON/YAML
cdk synth --json
cdk synth MyStack | head -100

# Check CDK version
cdk --version

# Show feature flags
cdk flags

# Open documentation
cdk docs
```

---

## Quick Summary Card

```
L1 (CfnXxx)    = Raw CloudFormation. Full control. Verbose. Use as escape hatch.
L2 (Xxx)       = Smart constructs. Defaults + helper methods. Use 90% of time.
L3 (XxxPattern)= Complete patterns. Least code. Opinionated. Use when it fits.

App            = Root container for all stacks
Stack          = One CloudFormation stack, one deployment unit
Construct      = Building block (L1/L2/L3 are all constructs)
Props          = TypeScript interface for configuration
Token          = Placeholder for values known only at deploy time
Asset          = Local file/folder/Docker image uploaded automatically
Aspect         = Visitor pattern — apply policy to ALL constructs
RemovalPolicy  = What happens when you destroy (DESTROY/RETAIN/SNAPSHOT)
Output         = Values printed after deploy (URLs, ARNs)
Context        = Key/value config passed to CDK at synth time

cdk synth      = TypeScript → CloudFormation JSON (no AWS calls)
cdk diff       = Show what will change (dry run)
cdk deploy     = Create/update real AWS resources
cdk destroy    = Delete all AWS resources in stack
```

---

*AWS CDK TypeScript Guide — for account `824033490704` | us-east-1*
