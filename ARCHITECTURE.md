# Three-Tier AWS Architecture — Complete Guide

---

## Table of Contents
1. [What is a 3-Tier Architecture?](#1-what-is-a-3-tier-architecture)
2. [Why Do We Build It This Way?](#2-why-do-we-build-it-this-way)
3. [What is AWS CDK?](#3-what-is-aws-cdk)
4. [Folder Structure Explained](#4-folder-structure-explained)
5. [The VPC — Your Private Network](#5-the-vpc--your-private-network)
6. [Tier 1 — Presentation Layer (ALB)](#6-tier-1--presentation-layer-alb)
7. [Tier 2 — Application Layer (EC2 ASG)](#7-tier-2--application-layer-ec2-asg)
8. [Tier 3 — Data Layer (RDS MySQL)](#8-tier-3--data-layer-rds-mysql)
9. [Security — How the Tiers are Isolated](#9-security--how-the-tiers-are-isolated)
10. [What is Production-Ready?](#10-what-is-production-ready)
11. [All AWS Resources Created](#11-all-aws-resources-created)
12. [How Traffic Flows](#12-how-traffic-flows)
13. [How to Connect & Operate](#13-how-to-connect--operate)
14. [Cost Breakdown](#14-cost-breakdown)
15. [CDK Commands Reference](#15-cdk-commands-reference)

---

## 1. What is a 3-Tier Architecture?

A **3-tier architecture** splits your application into three separate layers, each with a single responsibility.

```
INTERNET
   │
   ▼
┌─────────────────────────────┐
│  TIER 1 — PRESENTATION      │  ← The "front door" — handles incoming traffic
│  (Application Load Balancer)│
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  TIER 2 — APPLICATION       │  ← The "brain" — runs your actual code
│  (EC2 Auto Scaling Group)   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  TIER 3 — DATA              │  ← The "memory" — stores your data permanently
│  (RDS MySQL Database)       │
└─────────────────────────────┘
```

### The simple analogy — a restaurant:
| Architecture Tier | Restaurant Equivalent |
|---|---|
| Tier 1 — Presentation (ALB) | The front door & host — greets customers, decides which table |
| Tier 2 — Application (EC2) | The kitchen — actually cooks the food (runs your code) |
| Tier 3 — Data (RDS) | The pantry/fridge — stores all the ingredients (your data) |

Customers **never enter the kitchen directly**. The kitchen **never goes to the pantry without a chef**. Each layer only talks to the layer directly next to it.

---

## 2. Why Do We Build It This Way?

### Without 3-tier (bad — single server):
```
Internet → One EC2 instance running everything
              ├── Your app code
              ├── Database
              └── Web server
```
**Problems:**
- If the server goes down → **everything is down**
- If traffic spikes → **can't handle it, crashes**
- Database is exposed to the internet → **security risk**
- To update your app → **database goes down too**

### With 3-tier (good):
- **Tier 1 (ALB)** can distribute load across 10 servers — users never overwhelm one machine
- **Tier 2 (EC2 ASG)** auto-scales from 2 → 6 instances based on demand
- **Tier 3 (RDS)** is completely hidden — never reachable from the internet
- **Each tier can be updated independently** — update app code without touching the database

### The 4 production benefits:
| Benefit | How We Achieve It |
|---|---|
| **High Availability** | Resources spread across 3 Availability Zones |
| **Scalability** | Auto Scaling Group grows/shrinks EC2 count automatically |
| **Security** | Each tier isolated by Security Groups — no cross-tier access |
| **Reliability** | RDS Multi-AZ: if one AZ fails, standby promotes in 60 seconds |

---

## 3. What is AWS CDK?

**CDK = Cloud Development Kit**

Normally to create AWS resources, you click around in the AWS Console or write YAML/JSON (called CloudFormation). CDK lets you write **real TypeScript code** instead, which CDK converts to CloudFormation automatically.

### How it works:

```
You write TypeScript code
        │
        ▼
   cdk synth
        │
        ▼
CDK generates CloudFormation JSON templates
        │
        ▼
   cdk deploy
        │
        ▼
CloudFormation creates all AWS resources
```

### CDK vocabulary you need to know:

| Word | Meaning |
|---|---|
| **App** | The root of everything — `bin/app.ts` |
| **Stack** | A group of related AWS resources deployed together (like `NetworkStack`) |
| **Construct** | A reusable building block (like `ec2.Vpc` or `rds.DatabaseInstance`) |
| **Synth** | Convert TypeScript → CloudFormation JSON (no AWS calls) |
| **Deploy** | Upload templates to AWS and create the actual resources |
| **Bootstrap** | One-time setup: creates an S3 bucket CDK uses to store templates |
| **Diff** | Shows what will change before you deploy |

---

## 4. Folder Structure Explained

```
/Desktop/CDK/
│
├── bin/
│   └── app.ts              ← ENTRY POINT. Run this file to start everything.
│                             Instantiates all 4 stacks in order.
│                             Think of it as the "main()" of your infrastructure.
│
├── lib/
│   ├── network-stack.ts    ← STACK 1: Creates the VPC (your private AWS network)
│   │                         Everything else lives inside this network.
│   │                         No other stack can exist without this.
│   │
│   ├── presentation-stack.ts ← STACK 2: Creates the ALB (public load balancer)
│   │                           This is the only resource with a public URL.
│   │                           Depends on: network-stack.ts
│   │
│   ├── application-stack.ts ← STACK 3: Creates EC2 instances that run your app
│   │                          Instances are private — no public IP.
│   │                          Depends on: network-stack.ts + presentation-stack.ts
│   │
│   └── data-stack.ts        ← STACK 4: Creates RDS MySQL database
│                              Completely isolated — no internet access at all.
│                              Depends on: network-stack.ts
│
├── cdk.json                ← CDK configuration. Tells CDK how to run your app.
│                             (Don't need to edit this normally)
│
├── package.json            ← Node.js dependencies. Defines npm scripts.
│
├── tsconfig.json           ← TypeScript compiler settings.
│
└── cdk.out/                ← AUTO-GENERATED. CDK puts CloudFormation here.
                              Never edit this manually. Add to .gitignore.
```

### How the stacks depend on each other:

```
NetworkStack
    │
    ├──► PresentationStack
    │         │
    │         └──► ApplicationStack
    │
    └──► DataStack
```

CDK deploys them in this exact order. If NetworkStack fails, nothing else deploys.

---

## 5. The VPC — Your Private Network

**VPC = Virtual Private Cloud**

Think of a VPC as your own private section of AWS — like renting a floor in a skyscraper. AWS gives you the floor, and you decide how to divide the rooms.

### What we created:

```
VPC: 10.0.0.0/16  (65,536 possible IP addresses)
│
├── us-east-1a
│   ├── Public Subnet    10.0.0.0/24   (256 IPs) ← ALB lives here
│   ├── Private Subnet   10.0.3.0/24   (256 IPs) ← EC2 lives here
│   └── Isolated Subnet  10.0.6.0/24   (256 IPs) ← RDS lives here
│
├── us-east-1b
│   ├── Public Subnet    10.0.1.0/24
│   ├── Private Subnet   10.0.4.0/24
│   └── Isolated Subnet  10.0.7.0/24
│
└── us-east-1c
    ├── Public Subnet    10.0.2.0/24
    ├── Private Subnet   10.0.5.0/24
    └── Isolated Subnet  10.0.8.0/24
```

### The 3 types of subnets explained:

| Subnet Type | Has Internet? | Who lives here? | Why? |
|---|---|---|---|
| **Public** | Yes (via Internet Gateway) | ALB only | Needs to receive traffic from the internet |
| **Private** | Outbound only (via NAT Gateway) | EC2 instances | Can download packages, but internet can't reach them |
| **Isolated** | No internet at all | RDS database | Database never needs internet — maximum security |

### Internet Gateway vs NAT Gateway:

```
INTERNET GATEWAY
  ↕ (two-way traffic)
Public Subnet (ALB)

NAT GATEWAY (in public subnet)
  ↑ (one-way — outbound only)
Private Subnet (EC2)
  "I can call out to the internet, but internet can't call me"

ISOLATED SUBNET (RDS)
  ✗ No gateway at all
  "Completely air-gapped from internet"
```

### Why 3 NAT Gateways?
We created one NAT Gateway per Availability Zone. If AZ-1 goes down:
- **With 1 NAT Gateway:** ALL private subnets lose internet → app can't download updates, call AWS services
- **With 3 NAT Gateways:** Only AZ-1 is affected → AZ-2 and AZ-3 still work normally

---

## 6. Tier 1 — Presentation Layer (ALB)

**ALB = Application Load Balancer**

The ALB is the single public entry point for your entire application. It has a DNS name like:
```
three-tier-alb-1234567890.us-east-1.elb.amazonaws.com
```

### What it does:

```
Browser → http://three-tier-alb-xxxx.elb.amazonaws.com/
              │
              ALB checks: which EC2 instances are healthy?
              │
              ├── Instance i-001 (healthy) ← send traffic here
              ├── Instance i-002 (healthy) ← send traffic here
              └── Instance i-003 (unhealthy, app crashed) ← SKIP
```

### Health Checks — how ALB knows if an instance is healthy:
Every 30 seconds, the ALB sends:
```
GET http://<ec2-instance>:8080/health
```
- Returns `200 OK` → instance is healthy → send traffic to it
- Returns error or times out → instance is sick → stop sending traffic → ASG replaces it

**This means your app heals itself automatically.** No human intervention needed.

### What we built in PresentationStack:

| Resource | Purpose |
|---|---|
| `ApplicationLoadBalancer` | The load balancer itself — gets a public DNS name |
| `ApplicationListener` | Port 80 listener — accepts HTTP connections |
| `ApplicationTargetGroup` | Pool of EC2 instances — ALB sends traffic here |
| `S3 Bucket` | Stores ALB access logs (every request logged for 90 days) |

---

## 7. Tier 2 — Application Layer (EC2 ASG)

**ASG = Auto Scaling Group**

The ASG manages a group of EC2 instances. It ensures you always have healthy instances running and scales them up/down based on load.

### The EC2 instances:
- **OS:** Amazon Linux 2023 (latest, supported, AWS-optimized)
- **Size:** t3.small (2 vCPU, 2 GB RAM) — good starting point
- **Disk:** 20 GB gp3 EBS, encrypted
- **No public IP** — only reachable via the ALB

### Auto Scaling rules:
```
Normal traffic:    2 instances running  (minimum — always on for HA)
                   │
Traffic increases → CPU > 60% for 5 min
                   │
                   ▼
ASG launches new instances (up to 6 max)
                   │
Traffic decreases → CPU drops
                   │
                   ▼
ASG terminates extra instances (back to 2 min)
```

### What runs on each EC2 instance:
The user data script (runs on first boot) installs:
1. Node.js 20
2. A simple Express app on port 8080
3. systemd service (app auto-restarts if it crashes)
4. CloudWatch agent (ships logs/metrics to CloudWatch)

### App endpoints:
```
GET /health  →  {"status":"healthy","instance":"i-xxx","timestamp":"..."}
GET /        →  {"message":"Three-Tier App","tier":"Application",...}
```

### What we built in ApplicationStack:

| Resource | Purpose |
|---|---|
| `IAM Role` | Gives EC2 permission to call AWS services (SSM, CloudWatch, Secrets Manager) |
| `Launch Template` | Blueprint for every EC2 instance (AMI, size, disk, script) |
| `Auto Scaling Group` | Manages the fleet — min 2, max 6 instances |
| `Scaling Policy` | CPU target tracking — auto scales at 60% CPU |
| `CloudWatch Alarm` | Alerts if instance count drops below 2 |

### How to access instances (no SSH needed!):
```bash
# List instances in the ASG
aws ec2 describe-instances --filters "Name=tag:aws:autoscaling:groupName,Values=three-tier-app-asg" \
  --query "Reservations[].Instances[].InstanceId" --output text

# Connect via Systems Manager (like SSH but without opening any ports)
aws ssm start-session --target i-0abc123def456 --region us-east-1
```

---

## 8. Tier 3 — Data Layer (RDS MySQL)

**RDS = Relational Database Service**

AWS manages the database for you — patching, backups, failover, storage scaling. You just use it like a normal MySQL database.

### Multi-AZ explained:

```
us-east-1a                    us-east-1b
┌──────────────────┐          ┌──────────────────┐
│  PRIMARY (writes)│ ────────►│ STANDBY (replica) │
│  db.t3.medium    │ sync     │  db.t3.medium     │
│  MySQL 8.0       │ repl.    │  MySQL 8.0        │
└──────────────────┘          └──────────────────┘
        │
        ▼
   Your app connects here
   (one endpoint: three-tier-mysql.xxxx.us-east-1.rds.amazonaws.com)

If primary fails:
  → AWS detects failure (< 10 seconds)
  → Promotes standby to primary (< 60 seconds)
  → DNS endpoint automatically points to new primary
  → Your app reconnects automatically
  → Total downtime: ~60 seconds
```

### Production database settings:
| Setting | Value | Why |
|---|---|---|
| `multiAz` | true | Automatic failover across AZs |
| `storageEncrypted` | true | Data at rest encrypted with KMS |
| `backupRetention` | 7 days | Point-in-time restore for last 7 days |
| `deletionProtection` | false* | Set true in real prod to prevent accidents |
| `storageType` | GP3 | Better IOPS than GP2, same price |
| `maxAllocatedStorage` | 100 GB | Auto-grows without downtime |
| `performanceInsights` | enabled | Query-level analysis for slow queries |
| `cloudwatchLogsExports` | error, slowquery | Logs shipped to CloudWatch |

### How your app connects to the database:
```javascript
// In your application code — NEVER hardcode the password!
const { GetSecretValueCommand, SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: 'us-east-1' });
const response = await client.send(new GetSecretValueCommand({
  SecretId: 'three-tier/db/credentials'
}));
const { username, password } = JSON.parse(response.SecretString);

// Then connect using host from environment variable
const connection = mysql.createConnection({
  host: process.env.DB_HOST,      // RDS endpoint
  user: username,                  // 'admin'
  password: password,              // auto-generated 32-char password
  database: 'appdb'
});
```

---

## 9. Security — How the Tiers are Isolated

Security Groups are the core of 3-tier security. Think of them as **firewall rules at the resource level**.

### The Security Group chain:

```
┌─────────────────────────────────────────────────────┐
│ INTERNET (0.0.0.0/0)                                │
│          │                                          │
│          │ TCP port 80 ONLY                         │
│          ▼                                          │
│ ┌──────────────────┐                                │
│ │  albSg           │  ← Accepts: port 80 from internet
│ │  (ALB)           │     Rejects: everything else   │
│ └────────┬─────────┘                                │
│          │                                          │
│          │ TCP port 8080 from albSg ONLY            │
│          ▼                                          │
│ ┌──────────────────┐                                │
│ │  appSg           │  ← Accepts: port 8080 from ALB only
│ │  (EC2)           │     Rejects: direct internet    │
│ └────────┬─────────┘                                │
│          │                                          │
│          │ TCP port 3306 from appSg ONLY            │
│          ▼                                          │
│ ┌──────────────────┐                                │
│ │  dbSg            │  ← Accepts: port 3306 from EC2 only
│ │  (RDS)           │     Rejects: everything else   │
│ └──────────────────┘                                │
└─────────────────────────────────────────────────────┘
```

### What this means in practice:
- **Can a hacker reach RDS directly from the internet?** No — dbSg blocks everything except appSg
- **Can someone bypass the ALB and hit EC2 directly?** No — appSg only accepts traffic from albSg
- **Can RDS call out to the internet?** No — dbSg has `allowAllOutbound: false` + isolated subnet has no route
- **Can someone SSH into EC2?** No — port 22 is not open. Use SSM Session Manager instead.

### Other security measures:
| Measure | What it does |
|---|---|
| **IMDSv2 required** | Prevents SSRF attacks from reading EC2 metadata |
| **EBS encryption** | EC2 disk data encrypted at rest |
| **RDS encryption** | Database storage encrypted with KMS |
| **Secrets Manager** | DB password never in code, logs, or env vars |
| **VPC Flow Logs** | Records all network traffic for audit |
| **No public IPs on EC2** | Instances have no direct internet exposure |
| **S3 block public access** | ALB log bucket is private |

---

## 10. What is Production-Ready?

"Production-ready" means the architecture can handle real users reliably, securely, and without manual intervention. Here's what makes ours production-ready:

### High Availability (HA)
```
Failure scenario                → How we handle it
─────────────────────────────────────────────────────
One EC2 instance crashes        → ALB stops routing to it; ASG replaces it
Entire AZ goes down (us-east-1a)→ ALB routes to instances in 1b and 1c
RDS primary fails               → Standby in another AZ promoted in ~60s
High traffic spike              → ASG launches new instances automatically
```

### What's NOT in this setup (add for full production):
| Missing piece | What it does | How to add |
|---|---|---|
| **HTTPS / SSL** | Encrypts traffic between browser and ALB | Add ACM certificate + port 443 listener |
| **Route 53** | Custom domain name (myapp.com instead of ALB URL) | Create hosted zone + alias record |
| **WAF** | Web Application Firewall — blocks SQL injection, XSS | Attach `aws-wafv2` to ALB |
| **CloudFront CDN** | Caches static files globally — faster for users worldwide | Put CloudFront in front of ALB |
| **Bastion / VPN** | Secure access to private resources | Use SSM (already done) or AWS Client VPN |
| **SNS Alerts** | Email/Slack when CloudWatch alarms fire | Add `aws_sns.Topic` to alarms |
| **CI/CD Pipeline** | Auto-deploy when you push code | CodePipeline + CodeDeploy |

---

## 11. All AWS Resources Created

### NetworkStack (51 resources)
| Resource | Name | What it is |
|---|---|---|
| VPC | `three-tier-vpc` | Your private network (10.0.0.0/16) |
| Public Subnets | ×3 | One per AZ — ALB lives here |
| Private Subnets | ×3 | One per AZ — EC2 lives here |
| Isolated Subnets | ×3 | One per AZ — RDS lives here |
| Internet Gateway | 1 | Allows public subnets to reach internet |
| Elastic IPs | ×3 | Static IPs for NAT Gateways |
| NAT Gateways | ×3 | Allows private subnets outbound internet |
| Route Tables | ×9 | Routing rules for each subnet |
| Security Group | `three-tier-alb-sg` | Firewall for ALB (port 80 in) |
| Security Group | `three-tier-app-sg` | Firewall for EC2 (port 8080 from ALB) |
| Security Group | `three-tier-db-sg` | Firewall for RDS (port 3306 from EC2) |
| CloudWatch Log Group | `/aws/vpc/three-tier-flow-logs` | VPC traffic logs |
| Flow Log | 1 | Ships VPC traffic to CloudWatch |

### PresentationStack (8 resources)
| Resource | Name | What it is |
|---|---|---|
| S3 Bucket | `three-tier-alb-logs-<account>-us-east-1` | ALB access log storage |
| Application Load Balancer | `three-tier-alb` | Public-facing load balancer |
| ALB Listener | Port 80 | Accepts HTTP, routes to target group |
| Target Group | `three-tier-app-tg` | Pool of EC2 instances |

### ApplicationStack (7 resources)
| Resource | Name | What it is |
|---|---|---|
| IAM Role | `three-tier-ec2-role` | Permissions for EC2 instances |
| IAM Policy | DefaultPolicy | Secrets Manager access policy |
| Launch Template | `three-tier-app-lt` | EC2 blueprint (AMI, size, user data) |
| Auto Scaling Group | `three-tier-app-asg` | Manages EC2 fleet (min 2, max 6) |
| Scaling Policy | CpuScaling | Scale at 60% CPU target |
| CloudWatch Alarm | `ThreeTier-LowInstanceCount` | Alert if < 2 instances |

### DataStack (13 resources)
| Resource | Name | What it is |
|---|---|---|
| Secrets Manager Secret | `three-tier/db/credentials` | Auto-generated MySQL password |
| RDS Subnet Group | `three-tier-db-subnet-group` | Tells RDS to use isolated subnets |
| RDS Parameter Group | MySQL 8.0 params | Slow query logging, charset settings |
| RDS Instance | `three-tier-mysql` | MySQL 8.0, Multi-AZ, db.t3.medium |
| CloudWatch Alarm | `ThreeTier-RDS-HighCPU` | Alert if DB CPU > 80% |
| CloudWatch Alarm | `ThreeTier-RDS-LowFreeStorage` | Alert if storage < 2 GB |
| CloudWatch Alarm | `ThreeTier-RDS-HighConnections` | Alert if connections > 150 |

---

## 12. How Traffic Flows

### A user visits your website:

```
Step 1: User opens browser → http://<alb-dns-name>/
        DNS resolves the ALB's DNS name to an IP address

Step 2: Request hits the ALB (in public subnet, us-east-1a or 1b or 1c)
        ALB checks: which EC2 instances are healthy?
        ALB picks a healthy EC2 instance (round-robin)

Step 3: ALB forwards request to EC2 instance:8080 (in private subnet)
        EC2 Security Group allows this (appSg accepts from albSg only)

Step 4: Node.js app processes the request
        If it needs database data:
          → EC2 connects to RDS endpoint:3306 (in isolated subnet)
          → DB Security Group allows this (dbSg accepts from appSg only)
          → MySQL processes query, returns data
          → EC2 formats response

Step 5: Response travels back:
        RDS → EC2 → ALB → User's browser
```

### A new EC2 instance boots up:

```
Step 1: ASG detects it needs a new instance (low count or high CPU)
Step 2: ASG uses Launch Template to request a new EC2 instance
Step 3: EC2 boots with Amazon Linux 2023
Step 4: User data script runs (once, as root):
        - Downloads Node.js via NAT Gateway → internet
        - Installs Express app
        - Starts systemd service on port 8080
        - Starts CloudWatch agent
Step 5: ALB starts health checking: GET /health every 30s
Step 6: After 2 consecutive 200 OK responses → instance marked healthy
Step 7: ALB begins sending production traffic to this instance
```

---

## 13. How to Connect & Operate

### Check what's running:
```bash
# List all EC2 instances in the ASG
aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=three-tier-app-asg" \
  --query "Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress]" \
  --output table

# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --names three-tier-app-tg --query "TargetGroups[0].TargetGroupArn" --output text)

# Get the ALB DNS name (your app URL)
aws elbv2 describe-load-balancers --names three-tier-alb \
  --query "LoadBalancers[0].DNSName" --output text
```

### Connect to an EC2 instance (no SSH):
```bash
# Get an instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=three-tier-app-asg" \
            "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)

# Open a shell session
aws ssm start-session --target $INSTANCE_ID --region us-east-1

# Once inside the instance:
systemctl status three-tier-app    # Check if app is running
journalctl -u three-tier-app -f    # Follow app logs
curl localhost:8080/health          # Test app locally
```

### Get the database password:
```bash
aws secretsmanager get-secret-value \
  --secret-id three-tier/db/credentials \
  --query SecretString --output text | python3 -m json.tool
```

### View CloudWatch logs:
```bash
# VPC flow logs
aws logs tail /aws/vpc/three-tier-flow-logs --follow

# RDS error logs
aws logs tail /aws/rds/instance/three-tier-mysql/error --follow
```

### Scale manually (override ASG):
```bash
# Force scale up to 4 instances
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name three-tier-app-asg \
  --desired-capacity 4

# Back to 2
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name three-tier-app-asg \
  --desired-capacity 2
```

---

## 14. Cost Breakdown

### Approximate monthly cost (us-east-1):

| Resource | Quantity | Cost/unit | Monthly |
|---|---|---|---|
| NAT Gateway | 3 | ~$32/mo each | **~$96** |
| EC2 t3.small | 2 (minimum) | ~$15/mo each | **~$30** |
| RDS db.t3.medium Multi-AZ | 1 | ~$95/mo | **~$95** |
| ALB | 1 | ~$16/mo + usage | **~$16** |
| S3 (logs) | ~1 GB/mo | ~$0.023/GB | **~$1** |
| Data transfer | varies | ~$0.09/GB out | varies |
| **Total estimate** | | | **~$238/mo** |

### Cost-saving tips for dev/test:
```typescript
// In network-stack.ts — reduce to 1 NAT Gateway (saves ~$64/mo)
natGateways: 1,

// In data-stack.ts — disable Multi-AZ (saves ~$47/mo)
multiAz: false,

// In data-stack.ts — use smaller instance
instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),

// In application-stack.ts — run 1 instance in dev
minCapacity: 1,
desiredCapacity: 1,
```

---

## 15. CDK Commands Reference

```bash
# Install dependencies (first time only)
npm install

# Compile TypeScript (check for errors without deploying)
npm run build

# Preview CloudFormation templates (no AWS calls)
npx cdk synth

# Show what will change before deploying
npx cdk diff --all

# Deploy everything
npx cdk deploy --all

# Deploy a single stack
npx cdk deploy NetworkStack

# View deployed stack outputs (URLs, ARNs)
npx cdk deploy --all --outputs-file outputs.json
cat outputs.json

# Tear down everything (careful — deletes all resources!)
npx cdk destroy --all

# List all stacks
npx cdk list

# Open CDK documentation
npx cdk docs
```

### Stack deployment order:
```
npx cdk deploy NetworkStack           # First — always
npx cdk deploy PresentationStack      # Second
npx cdk deploy ApplicationStack       # Third
npx cdk deploy DataStack              # Can run parallel with Application
npx cdk deploy --all                  # Does all of the above in correct order
```

---

## Quick Reference Card

```
Your App URL:    http://<ALB DNS from outputs>
DB Endpoint:     <RDS endpoint from outputs>
DB Password:     aws secretsmanager get-secret-value --secret-id three-tier/db/credentials
Connect to EC2:  aws ssm start-session --target <instance-id> --region us-east-1
View logs:       aws logs tail /aws/vpc/three-tier-flow-logs --follow
CDK deploy:      npx cdk deploy --all
CDK destroy:     npx cdk destroy --all
```

---

*Generated for account `824033490704` | Region: `us-east-1` | Stack: ThreeTierArchitecture*
