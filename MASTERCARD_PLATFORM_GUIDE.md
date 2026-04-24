# Mastercard Platform Team — Complete End-to-End Guide
## How Everything Connects: Payments → Network → Cloud → Security → Developer Platform → Monitoring

---

## The One-Page Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        MASTERCARD GLOBAL PAYMENT NETWORK                            │
│                                                                                     │
│  Cardholder                                                                         │
│  swipes card ──► Merchant POS ──► Acquiring Bank ──► MASTERCARD NETWORK            │
│                                                              │                      │
│                                                    ┌─────────▼──────────┐          │
│                                                    │  Smart DNS          │          │
│                                                    │  Route to nearest   │          │
│                                                    │  region < 50ms      │          │
│                                                    └─────────┬──────────┘          │
│                                                              │                      │
│               ┌──────────────────────────────────────────────▼────────────┐        │
│               │              AWS CLOUD WAN (Global Backbone)               │        │
│               │  On-Prem DC ◄──────────────────────────────► AWS Regions  │        │
│               │  (exhausted IPs)              (IP-constrained VPCs)       │        │
│               └───────────┬──────────────────────────────────┬────────────┘        │
│                           │                                  │                      │
│               ┌───────────▼──────────┐          ┌───────────▼──────────┐           │
│               │  Proprietary HSMs    │          │  AWS CDK Platform    │           │
│               │  (PCI-DSS: Thales,   │          │  (TypeScript L3      │           │
│               │  Utimaco)            │          │   constructs)        │           │
│               │  PIN verify, keys,   │          │  Built by YOUR team  │           │
│               │  tokenization        │          └───────────┬──────────┘           │
│               └──────────────────────┘                      │                      │
│                                                  ┌───────────▼──────────┐           │
│                                                  │  BACKSTAGE PORTAL    │           │
│                                                  │  App teams self-     │           │
│                                                  │  serve AWS infra     │           │
│                                                  └───────────┬──────────┘           │
│                                                              │                      │
│                                                  ┌───────────▼──────────┐           │
│                                                  │  SYNTHETIC MONITORING │           │
│                                                  │  Fake transactions    │           │
│                                                  │  24/7 — catch issues  │           │
│                                                  │  before real users do │           │
│                                                  └──────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents
1. [Mastercard Payment Network — Authorization, Clearing, Settlement](#1-mastercard-payment-network)
2. [Smart DNS — Routing 160M Transactions/Day Globally](#2-smart-dns)
3. [AWS Cloud WAN — Mastercard's Global Network Backbone](#3-aws-cloud-wan)
4. [IP Constraints — On-Prem Exhaustion & AWS Scaling](#4-ip-constraints)
5. [Proprietary HSMs for PCI-DSS — Why Not KMS or CloudHSM](#5-proprietary-hsms-for-pci-dss)
6. [AWS CDK TypeScript — Platform Team's Job](#6-aws-cdk--the-platform-teams-job)
7. [Backstage — Developer Platform for App Teams](#7-backstage--developer-experience-platform)
8. [Synthetic Monitoring — Always-On Health Checks](#8-synthetic-monitoring)
9. [How Everything Connects — The Full Transaction Journey](#9-how-everything-connects--full-transaction-journey)
10. [Your Role in the Platform Team](#10-your-role-in-the-platform-team)

---

## 1. Mastercard Payment Network

### What actually happens when you tap your card?

Most people think it's instant. It's actually 3 separate processes:

```
TAP CARD                THAT NIGHT              2 DAYS LATER
    │                       │                        │
    ▼                       ▼                        ▼
AUTHORIZATION          CLEARING               SETTLEMENT
(< 2 seconds)          (batch, nightly)       (money moves)
"Is this card OK?"     "What happened today?" "Pay everyone"
```

---

### Part 1: Authorization (Real-Time, < 2 seconds)

This is the critical path. Every millisecond matters.

```
Step 1: You tap your Mastercard at Starbucks

Step 2: Starbucks POS terminal
        → Sends authorization request to their bank (Acquiring Bank, e.g., Chase)
        → Message format: ISO 8583 (the language of payments)
          Contains: Card number (PAN), amount, merchant ID, timestamp

Step 3: Acquiring Bank (Chase)
        → Forwards to Mastercard Network (Banknet)
        → Mastercard receives the request at nearest data center
          (Smart DNS routes to closest region — more on this later)

Step 4: Mastercard Processing (YOUR SYSTEMS)
        → Fraud check (AI models, velocity checks)
        → Route to correct Issuing Bank (e.g., Citibank if it's a Citi card)
        → This routing uses BIN (Bank Identification Number) — first 6-8 digits

Step 5: Issuing Bank (Citibank)
        → Checks: Does account exist? Enough funds? Card not blocked?
        → Sends back: APPROVED (00) or DECLINED (various codes)

Step 6: Response travels back in reverse
        Citi → Mastercard → Chase → Starbucks POS
        → "APPROVED" appears on screen

Total time: 200ms - 2000ms (under 2 seconds)
```

### ISO 8583 — The Language of Payments
```
Field 2:  Primary Account Number (PAN)     — the card number
Field 3:  Processing Code                  — purchase/refund/inquiry
Field 4:  Transaction Amount               — $5.75
Field 7:  Transmission Date/Time           — timestamp
Field 11: Systems Trace Audit Number (STAN)— unique ID for this transaction
Field 12: Local Transaction Time
Field 22: Point of Service Entry Mode      — chip, tap, swipe, manual
Field 35: Track 2 Data                     — magnetic stripe data
Field 39: Response Code                    — 00=approved, 51=insufficient funds
Field 41: Card Acceptor Terminal ID        — which terminal
Field 42: Card Acceptor ID                 — which merchant
```

### Response Codes (memorize these):
| Code | Meaning |
|---|---|
| `00` | Approved |
| `05` | Do not honor (generic decline) |
| `14` | Invalid card number |
| `51` | Insufficient funds |
| `54` | Expired card |
| `57` | Transaction not permitted |
| `91` | Issuer unavailable |
| `96` | System malfunction |

### Why this matters for your platform team:
- Authorization latency SLA: < 500ms (internal) end-to-end
- Uptime requirement: **99.999%** (5 nines = 5 min downtime/year)
- Volume: ~160 million transactions/day = ~1,850 transactions/second
- Peak: 5,000+ transactions/second (Black Friday, holiday season)

---

### Part 2: Clearing (Nightly Batch)

After the business day closes, all transactions are "cleared" — reconciled between banks.

```
End of Day:
  Starbucks' bank (Chase) sends Mastercard a file:
  "Here are all the transactions from today:
   - Txn #001: $5.75 from card ending 1234, merchant Starbucks NYC
   - Txn #002: $23.50 from card ending 5678, merchant Starbucks LA
   - ...10,000 more transactions"

Mastercard:
  - Validates every transaction
  - Matches to original authorization
  - Calculates net positions for each bank
  - Creates clearing files for each Issuing Bank

Output: Each bank knows exactly what they owe / are owed
```

### Part 3: Settlement (Money Actually Moves)

```
Mastercard tells the settlement bank:
  "Chase (acquiring bank): You are OWED $2.3M today"
  "Citibank (issuing bank): You OWE $1.8M today"
  "Bank of America: You OWE $0.5M today"

Settlement bank (e.g., Federal Reserve, local equivalent):
  → Moves actual money between bank accounts
  → Typically T+1 or T+2 (1-2 business days after transaction)

Mastercard earns:
  → Interchange fee: ~1.5-2.5% of transaction (goes to issuing bank)
  → Assessment fee: ~0.13% (goes to Mastercard)
  → Processing fee: fixed per transaction
```

---

## 2. Smart DNS

### The Problem Without Smart DNS

Mastercard has users in 210+ countries. Without smart routing:
```
A transaction in Singapore hits a server in Kansas City
Round-trip: Singapore → Kansas City → Singapore = 300ms+ just for DNS/network
Plus processing time = way over 2 second limit
```

### What Smart DNS Does

Smart DNS routes each transaction to the **nearest, healthiest** data center automatically.

```
Transaction from Singapore:
  DNS query: "Where is banknet.mastercard.com?"
  Smart DNS checks:
    1. Where is this request coming from? → Singapore
    2. Which region is closest? → Asia-Pacific (Singapore/Tokyo)
    3. Is that region healthy? → Yes (synthetic monitoring confirms)
    4. Return IP: 103.x.x.x (APAC endpoint)

Transaction from London:
  Same query → Smart DNS returns European endpoint
  → Frankfurt or Dublin AWS region

Transaction from Brazil:
  Same query → São Paulo AWS region
```

### How Mastercard Implements Smart DNS

```
Layers of Smart DNS:

1. ANYCAST ROUTING (Network Level)
   Same IP address announced from multiple locations
   BGP routes traffic to nearest location automatically
   Used for: Mastercard's global VIPs (Virtual IPs)

2. GEOLOCATION DNS (Application Level — Route 53)
   DNS responds differently based on source IP's country
   Africa    → Cape Town / Nigeria region
   Asia      → Singapore / Tokyo region
   Europe    → Frankfurt / Dublin region
   Americas  → Virginia / São Paulo region

3. LATENCY-BASED ROUTING (AWS Route 53)
   Measures actual latency from requester to each region
   Routes to lowest latency, not just geographic proximity
   More accurate than pure geo — a user in Eastern Europe
   might be faster to US-East than to Frankfurt

4. HEALTH-CHECK BASED FAILOVER
   Route 53 health checks run every 10 seconds
   If region fails health check → DNS automatically
   stops sending traffic there within 60 seconds
   Traffic shifts to next closest healthy region
```

### Route 53 Policy Types (CDK implementation):
```typescript
import * as route53 from 'aws-cdk-lib/aws-route53';

// Latency-based routing (what Mastercard likely uses)
new route53.RecordSet(this, 'ApacEndpoint', {
  zone: hostedZone,
  recordName: 'api.mastercard.internal',
  recordType: route53.RecordType.A,
  target: route53.RecordTarget.fromIpAddresses('10.x.x.x'),
  region: 'ap-southeast-1',         // Singapore
  setIdentifier: 'apac-primary',
  // Route 53 measures latency from user to this region
});

// Failover routing
new route53.RecordSet(this, 'Primary', {
  zone,
  recordName: 'api.mastercard.internal',
  recordType: route53.RecordType.A,
  target: ...,
  failover: route53.CfnRecordSet.FailoverProperty.PRIMARY,
  healthCheck: primaryHealthCheck,
});

new route53.RecordSet(this, 'Secondary', {
  zone,
  recordName: 'api.mastercard.internal',
  recordType: route53.RecordType.A,
  target: ...,
  failover: route53.CfnRecordSet.FailoverProperty.SECONDARY,
  // only used if primary health check fails
});
```

### Smart DNS + Anycast Together:
```
User in Tokyo initiates payment
         │
         ▼
DNS query for "banknet.mastercard.com"
         │
         ▼
Anycast: BGP routing → nearest Mastercard PoP → Tokyo PoP answers
         │
         ▼
Returns IP of Tokyo AWS region endpoint
         │
         ▼
Transaction processed in < 20ms network latency (same country)
         │
         ▼
If Tokyo fails → Route 53 health check detects within 10s
              → DNS TTL expires (30-60s)
              → Next query routes to Singapore
```

---

## 3. AWS Cloud WAN

### The Problem: Mastercard Has Both On-Prem AND Cloud

```
BEFORE Cloud WAN:
  On-Prem Data Centers (Kansas City, St. Louis, London...)
         │
         │  Direct Connect circuits (expensive, complex)
         │  Each region needs its own connection
         │
  AWS Regions (us-east-1, eu-west-1, ap-southeast-1...)

  Managing this = a nightmare of:
  - Separate Transit Gateways per region
  - Complex peering between regions
  - Manual route tables everywhere
  - No global visibility
```

### What AWS Cloud WAN Provides

```
AFTER Cloud WAN:
  On-Prem DC ─────────────────────────────────────────────────────┐
                                                                   │
  AWS us-east-1 ──────────────────────────────────────────────────┤
                                                                   │
  AWS eu-west-1 ──────────────────────────────────────────────────┤
                                                             AWS CLOUD WAN
  AWS ap-southeast-1 ─────────────────────────────────────────────┤
                                                                   │
  AWS sa-east-1 ──────────────────────────────────────────────────┘

  One global network. Managed centrally. Software-defined.
```

### Cloud WAN Components:

```
GLOBAL NETWORK
└── Core Network
    ├── Core Network Policy (JSON — defines the whole network)
    ├── Segments (like VLANs — isolate traffic types)
    │   ├── "production"  segment  — payment processing traffic
    │   ├── "management"  segment  — ops/monitoring traffic
    │   └── "development" segment  — dev/test traffic
    │
    └── Edges (where traffic enters/exits)
        ├── Edge in us-east-1 (Virginia)
        ├── Edge in eu-central-1 (Frankfurt)
        ├── Edge in ap-southeast-1 (Singapore)
        └── Edge in on-prem (via Direct Connect Gateway)
```

### Why Mastercard Needs This — Segment Isolation:
```
Payment traffic (production segment):
  On-prem HSMs ◄──────► AWS us-east-1 (authorization services)
  NEVER touches dev segment
  Encrypted in transit (MACsec on Direct Connect)

Management traffic (management segment):
  Operations team → monitoring dashboards
  Can see production metrics but cannot touch production data

Development traffic (development segment):
  Dev teams → test environments
  Completely isolated from production
  Cannot route to production segment
```

### Cloud WAN + IP Constraints (connects to next section):
```typescript
// CDK for Cloud WAN core network policy
const coreNetworkPolicy = {
  "version": "2021.12",
  "core-network-configuration": {
    "asn-ranges": ["64512-64555"],
    "edge-locations": [
      { "location": "us-east-1" },
      { "location": "eu-central-1" },
      { "location": "ap-southeast-1" }
    ]
  },
  "segments": [
    {
      "name": "production",
      "require-attachment-acceptance": true,
      "isolate-attachments": false  // production segments CAN talk to each other
    },
    {
      "name": "development",
      "require-attachment-acceptance": false,
      "isolate-attachments": true   // dev segments CANNOT talk to each other
    }
  ],
  "segment-actions": [
    {
      "action": "share",
      "mode": "attachment-route",
      "segment": "production",
      "share-with": ["production"]  // only production talks to production
    }
  ]
};
```

---

## 4. IP Constraints

### The Core Problem

```
ON-PREMISES (Mastercard Data Centers):
  Mastercard has been running since 1966.
  Decades of on-prem infrastructure = THOUSANDS of servers
  All using private RFC 1918 address space:
    10.0.0.0/8     → 16 million addresses  (most used up by on-prem)
    172.16.0.0/12  → 1 million addresses   (partially used)
    192.168.0.0/16 → 65,536 addresses      (too small for enterprise)

  Problem: On-prem has consumed most of 10.0.0.0/8
  You can't create VPCs with ranges that OVERLAP on-prem
  If you do → packets get confused → transactions fail
```

### Why This Matters for Your CDK Work

```
ON-PREM uses:       10.0.0.0/8  (10.anything)
AWS VPCs CANNOT use: 10.0.0.0/8  (would overlap)

Where do you put AWS VPCs?
  Option 1: Carve out unused 10.x.x.x ranges (complex, coordination needed)
  Option 2: Use 172.16.0.0/12 range
  Option 3: Use non-overlapping 100.64.0.0/10 (CGNAT range — unusual but valid)
  Option 4: Use IPv6 (longer term solution)
```

### Mastercard's IP Strategy in AWS:

```
REGION: us-east-1
  Production VPC:     172.16.0.0/16   (65,534 IPs)
    Public Subnets:   172.16.0.0/24   (254 IPs per AZ × 3 AZs)
    Private Subnets:  172.16.10.0/23  (510 IPs per AZ × 3 AZs)
    Isolated Subnets: 172.16.20.0/24  (254 IPs per AZ × 3 AZs)

REGION: eu-central-1
  Production VPC:     172.17.0.0/16   (non-overlapping!)
    ...

REGION: ap-southeast-1
  Production VPC:     172.18.0.0/16   (non-overlapping!)
    ...

ON-PREM:
  Data Center 1:      10.10.0.0/16
  Data Center 2:      10.11.0.0/16
  ...
  NEVER overlaps with 172.16.x.x range
```

### IP Address Conservation Techniques:

```
1. SMALLER SUBNETS — only allocate what you need
   Don't use /16 everywhere
   RDS isolated subnet: /27 (30 IPs) — you only have 2-3 RDS instances
   EC2 private subnet: /23 (510 IPs) — ASG might grow to 50 instances

2. IPv6 DUAL-STACK — long-term solution
   Every VPC gets a /56 IPv6 block from Amazon (free, unlimited)
   Internal services communicate over IPv6
   Eliminates IP exhaustion for new workloads

3. VPC SHARING (AWS Resource Access Manager)
   Instead of one VPC per app team (wasteful):
   Platform team owns VPCs
   App teams share subnets in platform VPCs
   Saves hundreds of VPC CIDR blocks

4. PRIVATE NAT GATEWAY
   Multiple VPCs can share same IP range internally
   NAT translates between overlapping ranges
   Allows connecting to on-prem that has same range

5. TRANSIT GATEWAY + SUPERNET SUMMARIZATION
   Advertise summary routes to on-prem (172.16.0.0/12 covers all AWS)
   On-prem router knows: anything 172.16.x.x → go to AWS
   Reduces routing table complexity
```

### CDK for IP-Constrained VPC:
```typescript
// Platform team's CDK construct for IP-constrained VPCs
export class MastercardVpc extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: {
    region: string,
    environment: 'prod' | 'dev',
    vpcCidr: string,          // passed in from central IP registry
  }) {
    super(scope, id);

    // CIDR assigned centrally by network team
    // Never allow teams to pick their own — leads to overlap
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr), // e.g. '172.16.0.0/16'
      maxAzs: 3,
      natGateways: props.environment === 'prod' ? 3 : 1,

      // Use IPv6 to reduce pressure on IPv4
      ipv6Addresses: ec2.Ipv6Addresses.amazonProvided(),

      subnetConfiguration: [
        { name: 'Public',   subnetType: ec2.SubnetType.PUBLIC,              cidrMask: 24 },
        { name: 'Private',  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED,    cidrMask: 25 },
      ],
    });

    // Attach to Cloud WAN for connectivity to on-prem and other regions
    // (Cloud WAN attachment configured separately by network team)
  }
}
```

---

## 5. Proprietary HSMs for PCI-DSS

### What is PCI-DSS?

**PCI-DSS = Payment Card Industry Data Security Standard**

If you touch cardholder data, you must comply. Non-compliance = massive fines + losing ability to process cards.

```
PCI-DSS Key Requirements relevant to Mastercard:
  Req 3:  Protect stored cardholder data (encrypt PANs, CVVs)
  Req 4:  Encrypt transmission of cardholder data
  Req 6:  Develop secure systems and software
  Req 10: Log and monitor all access to network resources
  Req 12: Maintain an information security policy
```

### Why Mastercard CANNOT Use AWS KMS or CloudHSM for Everything

```
AWS KMS:
  Keys are managed by AWS
  AWS employees technically could access key material
  For PCI HSM requirement — auditors want PROOF of exclusive control
  KMS doesn't give you that proof
  Status: NOT acceptable for primary card encryption keys

AWS CloudHSM:
  Hardware you exclusively control (in theory)
  But: The hardware lives in AWS data centers
  AWS controls physical access to the hardware
  For Mastercard's tier-1 cryptographic operations:
    → Not acceptable under Mastercard's own security standards
    → Audit risk: "Can AWS physically access your HSM?"
    → Answer should be "No" — with CloudHSM it's complicated

Proprietary HSMs (Thales, Utimaco, nCipher):
  Physically in Mastercard-controlled data centers (on-prem)
  OR in AWS data centers under Mastercard's physical custody agreement
  Full audit trail Mastercard controls
  Certified to FIPS 140-2 Level 3 or Level 4
  PCI HSM certification (separate from FIPS)
  → ACCEPTABLE for tier-1 key operations
```

### What HSMs Do in Mastercard's Payment Flow:

```
1. PIN VERIFICATION (PVV — PIN Verification Value)
   Customer enters PIN at ATM
   ATM encrypts PIN using a key known only to the HSM
   Mastercard HSM decrypts, verifies PIN is correct
   NEVER stored in plaintext anywhere

2. CARD DATA ENCRYPTION
   PAN (card number) encrypted with zone master keys
   Keys managed exclusively in HSM
   Encrypted card data stored in databases
   Decryption only possible via HSM

3. TOKENIZATION
   Replace real card number (PAN) with a "token"
   e.g., Real PAN: 5412 3456 7890 1234
         Token:    9876 5432 1098 7654 (useless if stolen)
   Token vault mapping stored in HSM-protected storage
   Token → PAN conversion only in HSM

4. 3-D SECURE (3DS) — the "Verified by Mastercard"
   Generates cryptograms for online transactions
   HMAC/cryptographic signatures using HSM keys

5. KEY MANAGEMENT HIERARCHY
   Master Key (LMK — Local Master Key)
     └── Zone Master Keys (per partner bank)
           └── Working Keys (per session/day)
                 └── Encrypts transaction data
   
   Master Key NEVER leaves the HSM
   All key generation happens inside HSM
```

### How Proprietary HSMs Connect to AWS Cloud:

```
On-Prem Mastercard DC
┌─────────────────────────────────────────┐
│  Thales payShield 10K HSMs (cluster)    │
│  FIPS 140-2 Level 3, PCI HSM Certified  │
│                                         │
│  HSM API exposed on internal network    │
│  Port 1500 (Thales PKCS#11 / Net+LUNA)  │
└───────────────┬─────────────────────────┘
                │
                │ AWS Direct Connect (dedicated fiber, encrypted)
                │ MACsec encryption on the link
                │
┌───────────────▼─────────────────────────┐
│  AWS Cloud (your platform team's VPC)   │
│                                         │
│  ┌────────────────────────────────┐     │
│  │  HSM Client Proxy              │     │
│  │  (EC2 instance in private      │     │
│  │   subnet — no internet access) │     │
│  │                                │     │
│  │  Translates PKCS#11 calls to   │     │
│  │  on-prem HSM over Direct       │     │
│  │  Connect                       │     │
│  └────────────┬───────────────────┘     │
│               │                         │
│  Payment apps call HSM proxy            │
│  "Encrypt this PAN" → proxy → HSM       │
└─────────────────────────────────────────┘
```

### Where AWS KMS IS Used (non-card data):
```
AWS KMS is fine for:
  ✅ Encrypting EC2 EBS volumes
  ✅ Encrypting S3 buckets (logs, configs)
  ✅ Encrypting non-PAN database fields
  ✅ Secrets Manager encryption
  ✅ CloudWatch Logs encryption

Proprietary HSMs required for:
  ❌ (No KMS) Primary Account Numbers (PAN)
  ❌ (No KMS) PIN blocks
  ❌ (No KMS) Card verification values (CVV/CVC)
  ❌ (No KMS) Cryptographic key generation for payment keys
  ❌ (No KMS) 3DS cryptograms
```

---

## 6. AWS CDK — The Platform Team's Job

### What the Platform Team Builds with CDK

Application teams at Mastercard shouldn't need to know how to configure a VPC, set up Security Groups, or wire up Cloud WAN. That's **your job**.

You build **golden path constructs** — pre-approved, pre-secured, pre-compliant infrastructure patterns that app teams consume.

```
PLATFORM TEAM (You)                    APP TEAMS
─────────────────                      ──────────
Build L3 Constructs:                   Use Constructs:

MastercardVpc            ─────────►    "Give me a VPC"
MastercardEcsService     ─────────►    "Give me a container service"
MastercardRds            ─────────►    "Give me a database"
MastercardHsmClient      ─────────►    "Give me HSM access"
MastercardAlb            ─────────►    "Give me a load balancer"
MastercardMonitoring     ─────────►    "Give me dashboards and alarms"
```

### Example: Your L3 Construct for a PCI-Compliant Service

```typescript
// lib/constructs/mastercard-payment-service.ts
// Platform team writes this ONCE
// App teams use it hundreds of times

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface PaymentServiceProps {
  vpc: ec2.Vpc;
  serviceName: string;           // e.g., 'authorization-service'
  containerImage: ecs.ContainerImage;
  desiredCount?: number;         // defaults to 3 for HA
  pciScope: boolean;             // true = stricter controls
}

export class MastercardPaymentService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: PaymentServiceProps) {
    super(scope, id);

    // Platform team enforces PCI requirements automatically:
    // - Containers run as non-root
    // - Read-only root filesystem
    // - No privilege escalation
    // - Logs encrypted and shipped to CloudWatch
    // - Network isolated — only ALB can reach it
    // - IMDSv2 required
    // - All traffic encrypted (TLS)
    // App team gets all of this for FREE just by using this construct

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: `mc-${props.serviceName}`,
      containerInsights: true,      // required for PCI monitoring
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    taskDef.addContainer('App', {
      image: props.containerImage,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: props.serviceName,
        logRetention: props.pciScope ? 365 : 30, // PCI: 1 year log retention
      }),
      readonlyRootFilesystem: props.pciScope, // PCI: immutable containers
      user: props.pciScope ? '1000' : undefined, // PCI: non-root user
      portMappings: [{ containerPort: 8080 }],
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: props.desiredCount ?? 3,
      assignPublicIp: false,        // NEVER public in Mastercard
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Auto-scaling built in — platform team sets sensible defaults
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: props.desiredCount ?? 3,
      maxCapacity: 50,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
    });
  }
}

// App team usage — 3 lines to get a fully PCI-compliant service:
new MastercardPaymentService(this, 'AuthorizationService', {
  vpc: platformVpc,
  serviceName: 'authorization',
  containerImage: ecs.ContainerImage.fromEcr(authRepo),
  pciScope: true,
});
```

### CDK Library Structure for Platform Team:

```
mastercard-cdk-constructs/          ← npm package published internally
├── lib/
│   ├── network/
│   │   ├── mastercard-vpc.ts       ← IP-constrained VPC
│   │   ├── cloud-wan-attachment.ts ← Connect VPC to Cloud WAN
│   │   └── smart-dns.ts            ← Route 53 latency routing
│   │
│   ├── compute/
│   │   ├── payment-service.ts      ← PCI ECS Fargate service
│   │   ├── batch-processor.ts      ← Clearing/settlement batch jobs
│   │   └── lambda-function.ts      ← Compliant Lambda wrapper
│   │
│   ├── data/
│   │   ├── payment-database.ts     ← RDS with encryption + HSM integration
│   │   └── event-store.ts          ← Kinesis for transaction events
│   │
│   ├── security/
│   │   ├── hsm-client.ts           ← Proxy to on-prem HSMs
│   │   ├── pci-security-group.ts   ← Pre-approved SG rules
│   │   └── key-management.ts       ← KMS for non-PAN data
│   │
│   └── observability/
│       ├── synthetic-monitor.ts    ← CloudWatch Synthetics
│       ├── dashboard.ts            ← Standard dashboards
│       └── alarms.ts               ← SLA-based alarms
│
└── package.json                    ← Published to internal npm registry
```

---

## 7. Backstage — Developer Experience Platform

### The Problem Without Backstage

```
WITHOUT BACKSTAGE — App team wants to deploy a new payment service:

  Day 1:  Submit request to platform team via Jira ticket
  Day 3:  Platform team reviews, asks for more info
  Day 5:  Platform team creates VPC, IAM roles, ECR repo...
  Day 8:  App team gets access — but wrong region
  Day 10: Platform team fixes region
  Day 12: App team discovers they also need RDS — new ticket
  ...
  Day 25: App team finally has their service running

Result: Platform team buried in tickets. App teams frustrated.
        Mastercard can't ship features fast enough.
```

### What Backstage Provides

```
WITH BACKSTAGE — Same app team, same service:

  Day 1:  Dev opens Backstage portal
          Selects "New Payment Service" template
          Fills form: service name, region, team, PCI-scope Y/N
          Clicks "Create"

  Day 1:  Backstage:
          → Generates CDK code from template
          → Creates GitHub repo with the code
          → Triggers CI/CD pipeline
          → CDK deploy runs

  Day 2:  Service is running. Dev got email with:
          → App URL
          → Dashboard link
          → Runbook link
          → On-call rotation

Result: Platform team writes templates once.
        App teams self-serve in 24 hours.
        Every service follows the golden path automatically.
```

### Backstage Architecture at Mastercard:

```
                    BACKSTAGE PORTAL
                 (internal.mastercard.com/backstage)
                          │
         ┌────────────────┼────────────────────┐
         │                │                    │
         ▼                ▼                    ▼
   SOFTWARE            TECH DOCS           TEMPLATES
   CATALOG             (TechDocs)          (Scaffolder)
         │                                    │
   "Show me all         "Documentation        "Create new
   services my          for this service"     service / infra"
   team owns"                                      │
         │                                         │
         ▼                                         ▼
   All services        Markdown docs         Calls CDK +
   in Mastercard       auto-published        GitHub + CI/CD
   listed here         from repos            triggers deploy
```

### Backstage Software Catalog — What It Shows:

```yaml
# catalog-info.yaml — every repo has this file
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: authorization-service
  description: Real-time transaction authorization
  annotations:
    github.com/project-slug: mastercard/authorization-service
    backstage.io/techdocs-ref: dir:.
    pagerduty.com/service-id: PXXXXXX
    aws.amazon.com/account-id: "824033490704"
    aws.amazon.com/region: us-east-1
  tags:
    - pci-in-scope
    - payment-critical
    - tier-1
  links:
    - url: https://grafana.internal/d/auth-service
      title: Grafana Dashboard
    - url: https://runbooks.mastercard.internal/authorization
      title: Runbook
spec:
  type: service
  lifecycle: production
  owner: group:authorization-team
  system: payment-network
  dependsOn:
    - component:hsm-proxy
    - component:fraud-detection
    - resource:payment-database
```

### Backstage Scaffolder Template (what platform team writes):

```typescript
// Platform team writes this template ONCE
// App teams fill out a form and get everything below automatically

apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: mastercard-payment-service
  title: New Payment Service (PCI-Compliant)
  description: Creates a fully compliant payment processing service
spec:
  parameters:
    - title: Service Details
      properties:
        serviceName:
          type: string
          description: Service name (e.g., fraud-detection)
        teamName:
          type: string
        pciScope:
          type: boolean
          description: Is this service in PCI scope?
        awsRegion:
          type: string
          enum: [us-east-1, eu-central-1, ap-southeast-1]

  steps:
    - id: generate-cdk
      name: Generate CDK Infrastructure
      action: mastercard:cdk:generate
      input:
        template: payment-service-template
        values: ${{ parameters }}

    - id: create-repo
      name: Create GitHub Repository
      action: publish:github
      input:
        repoUrl: github.com/mastercard/${{ parameters.serviceName }}

    - id: deploy-infra
      name: Deploy Infrastructure
      action: mastercard:deploy:cdk
      input:
        stackName: ${{ parameters.serviceName }}-stack

    - id: register-catalog
      name: Register in Software Catalog
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.create-repo.output.repoContentsUrl }}
```

### What App Teams See in Backstage:
```
┌─────────────────────────────────────────────────────────────┐
│ BACKSTAGE — Mastercard Developer Portal                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  My Services (Authorization Team)                           │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ authorization-svc   │  │ fraud-detection-svc         │  │
│  │ ✅ Production        │  │ ✅ Production                │  │
│  │ Latency: 45ms avg   │  │ Latency: 12ms avg           │  │
│  │ Error rate: 0.001%  │  │ Error rate: 0.002%          │  │
│  │ [Dashboard] [Logs]  │  │ [Dashboard] [Logs]          │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                             │
│  Create New Service                                         │
│  [+ Payment Service] [+ Batch Job] [+ Internal API]        │
│                                                             │
│  Tech Docs                                                  │
│  [HSM Integration Guide] [PCI Compliance Checklist]        │
│  [Cloud WAN Connectivity] [IP Address Request Form]        │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Synthetic Monitoring

### What is Synthetic Monitoring?

**Synthetic monitoring = fake transactions that run 24/7 to prove real ones would work.**

```
REAL monitoring (reactive):
  Real user's transaction fails
  → Alert fires
  → Team investigates
  → Users already impacted for 5-10 minutes

SYNTHETIC monitoring (proactive):
  Fake transaction runs every 60 seconds
  → Fake transaction fails
  → Alert fires IMMEDIATELY
  → Team investigates
  → Real users never impacted
```

### What Mastercard Synthetics Test:

```
Every 60 seconds, synthetic monitors simulate:

1. AUTHORIZATION CANARY
   → Create a test card (never a real card number)
   → Submit a $0.01 authorization to test environment
   → Verify: response time < 500ms
   → Verify: response code = 00 (approved)
   → Verify: all downstream services responded

2. CLEARING CANARY
   → Simulate end-of-day file generation
   → Verify: file format is valid ISO 8583
   → Verify: reconciliation counts match
   → Verify: file delivered to test endpoint

3. HSM CONNECTIVITY CANARY
   → Call HSM proxy: "Encrypt this test value"
   → Verify: response received < 100ms
   → Verify: response is valid ciphertext
   → Alert if HSM unreachable (before real transactions fail)

4. SMART DNS CANARY
   → From each region: resolve banknet.mastercard.com
   → Verify: DNS response points to correct region
   → Verify: resolved IP is reachable
   → Verify: TLS certificate valid (not expired)

5. CROSS-REGION FAILOVER CANARY
   → Simulate primary region failure
   → Verify: traffic routes to secondary within 90 seconds
   → Verify: secondary handles full load

6. DATABASE CANARY
   → Connect to RDS (test instance)
   → Run: SELECT 1 (basic connectivity)
   → Run: test transaction insert + rollback
   → Verify: replication lag < 1 second
```

### Implementation with AWS CloudWatch Synthetics:

```typescript
import * as synthetics from 'aws-cdk-lib/aws-synthetics';
import * as cdk from 'aws-cdk-lib';

// Authorization canary — runs every minute
const authCanary = new synthetics.Canary(this, 'AuthorizationCanary', {
  canaryName: 'mc-authorization-canary',
  schedule: synthetics.Schedule.rate(cdk.Duration.minutes(1)),
  test: synthetics.Test.custom({
    code: synthetics.Code.fromAsset('./canaries/authorization'),
    handler: 'authorization.handler',
  }),
  runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
  environmentVariables: {
    AUTH_ENDPOINT: 'https://auth-test.internal.mastercard.com',
    TEST_PAN: process.env.SYNTHETIC_TEST_PAN!,   // fake card number
    EXPECTED_RESPONSE: '00',
  },
  failureRetentionPeriod: cdk.Duration.days(30),
  successRetentionPeriod: cdk.Duration.days(7),
});

// canaries/authorization/authorization.js
// (runs inside CloudWatch Synthetics runtime)
const synthetics = require('Synthetics');
const https = require('https');

exports.handler = async () => {
  const startTime = Date.now();

  // Simulate an authorization request
  const response = await callAuthorizationAPI({
    pan: process.env.TEST_PAN,
    amount: 1,         // $0.01
    merchantId: 'SYNTHETIC_MONITOR_001',
  });

  const latency = Date.now() - startTime;

  // Record custom metrics
  await synthetics.addExecutionError(
    latency > 500 ? `Latency too high: ${latency}ms` : null
  );

  if (response.responseCode !== '00') {
    throw new Error(`Expected 00, got ${response.responseCode}`);
  }

  if (latency > 500) {
    throw new Error(`Latency ${latency}ms exceeds 500ms SLA`);
  }

  return 'Authorization canary passed';
};

// Alarm on canary failure
new cloudwatch.Alarm(this, 'AuthCanaryAlarm', {
  alarmName: 'MC-AuthorizationCanaryFailed',
  alarmDescription: 'Synthetic authorization test failed — investigate immediately',
  metric: authCanary.metricFailed({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 1,
  evaluationPeriods: 1,
  // In production: action = SNS → PagerDuty → on-call engineer
});
```

### Synthetic Monitoring Dashboard:

```
MASTERCARD PLATFORM — SYNTHETIC MONITORING DASHBOARD
Last updated: 30 seconds ago

PAYMENT NETWORK STATUS
┌────────────────────────────────────────────────────────────┐
│ Authorization   🟢 PASSING  Latency: 187ms  (SLA: 500ms)  │
│ Clearing        🟢 PASSING  Last run: 47s ago              │
│ Settlement      🟢 PASSING  Last run: 2m ago               │
├────────────────────────────────────────────────────────────┤
│ HSM Connectivity 🟢 PASSING  Latency: 23ms                 │
│ Smart DNS        🟢 PASSING  All regions resolving         │
│ Cloud WAN        🟢 PASSING  All segments healthy          │
├────────────────────────────────────────────────────────────┤
│ us-east-1        🟢 HEALTHY  187ms auth latency            │
│ eu-central-1     🟢 HEALTHY  203ms auth latency            │
│ ap-southeast-1   🟡 WARNING  412ms auth latency (↑ from 201ms) │
└────────────────────────────────────────────────────────────┘
```

---

## 9. How Everything Connects — Full Transaction Journey

This is the complete picture of a single card swipe through your entire platform:

```
CUSTOMER TAPS CARD IN SINGAPORE (9:00:00.000)
│
▼
SMART DNS (9:00:00.010 — 10ms)
  DNS query: "banknet.mastercard.com"
  Route 53 Latency Policy: Singapore → ap-southeast-1
  Return: 172.18.5.10 (Singapore ALB)
│
▼
AWS CLOUD WAN (9:00:00.020 — 10ms)
  Traffic enters via ap-southeast-1 edge
  Segment: "production"
  Routes to: Authorization Service VPC (172.18.0.0/16)
  IP is not overlapping because on-prem uses 10.x.x.x
│
▼
ALB → ECS FARGATE (Authorization Service) (9:00:00.030)
  Built with your Backstage-scaffolded CDK template
  MastercardPaymentService L3 construct
  ECS Task in private subnet (172.18.10.x)
│
▼
FRAUD CHECK (9:00:00.070 — 40ms)
  Authorization service calls Fraud Detection service
  Internal Cloud WAN routing (same production segment)
  Result: PASS (not fraudulent)
│
▼
HSM CALL (9:00:00.090 — 20ms)
  Authorization service needs to verify PIN block
  Calls HSM Proxy (EC2 in private subnet)
  HSM Proxy → Direct Connect → On-Prem Thales HSM
  HSM decrypts PIN, verifies against stored value
  Returns: VALID
│
▼
ROUTE TO ISSUING BANK (9:00:00.110 — 20ms)
  BIN lookup: card starts with 5412 → Citibank Singapore
  Message routed via Banknet to Citibank
  Citibank checks: account active, sufficient funds
  Returns: APPROVED (00)
│
▼
RESPONSE RETURNS (9:00:00.200 — 90ms return journey)
  Citibank → Mastercard → ALB → Merchant terminal
  "APPROVED" appears on POS screen
│
▼
SYNTHETIC MONITOR VALIDATES (9:01:00.000 — 1 minute later)
  Canary runs its own fake transaction
  Measures: 195ms (within SLA)
  Backstage dashboard shows: 🟢 ap-southeast-1 HEALTHY
│
▼
NIGHTLY CLEARING (End of Day)
  Batch job (CDK-deployed ECS Batch)
  Generates ISO 8583 clearing files
  Encrypted with on-prem HSM key
  Delivered to acquiring/issuing banks
│
▼
SETTLEMENT (T+1)
  Net positions calculated
  Money moves between bank accounts
  Mastercard collects interchange + assessment fees

TOTAL TIME FOR AUTHORIZATION: 200ms
TOTAL SYSTEM UPTIME REQUIREMENT: 99.999%
```

---

## 10. Your Role in the Platform Team

### What the Platform Team Owns:

```
YOU BUILD AND MAINTAIN:
  ✅ CDK construct library (mastercard-cdk-constructs npm package)
  ✅ VPC designs for each region (IP addresses, subnets)
  ✅ Cloud WAN configuration and segment policies
  ✅ Smart DNS (Route 53) policies and health checks
  ✅ HSM proxy infrastructure (EC2 cluster, networking)
  ✅ Backstage portal (templates, plugins, catalog)
  ✅ Synthetic monitoring framework (canary templates)
  ✅ CI/CD pipelines for infrastructure
  ✅ Shared services (logging, monitoring, alerting)

APP TEAMS BUILD AND MAINTAIN:
  ✅ Their service code (Node.js, Java, Python apps)
  ✅ Their CDK stacks (using YOUR constructs)
  ✅ Their canary tests (using YOUR canary framework)
  ✅ Their runbooks (published via YOUR Backstage)
```

### Day-to-Day Activities:

```
REACTIVE (when things break):
  → Synthetic monitor fires → investigate HSM connectivity
  → App team can't deploy → debug CDK construct issue
  → Latency spike in APAC → Smart DNS failover issue

PROACTIVE (normal days):
  → New AWS service released → evaluate, build L3 construct
  → New region needed → provision VPC, Cloud WAN attachment
  → New team onboarding → create Backstage template for them
  → Quarterly PCI audit → evidence collection, control review

STRATEGIC (big projects):
  → IPv6 migration (solve IP exhaustion permanently)
  → New HSM vendor evaluation (Thales → new model)
  → Cloud WAN expansion to new AWS region
  → Backstage plugin development for Mastercard-specific tools
```

### The Skills You Need (from your manager's list + more):

| Skill | Why Mastercard Needs It | Your Learning Priority |
|---|---|---|
| AWS CDK TypeScript | Build golden-path constructs for 100s of app teams | HIGH — build daily |
| Smart DNS / Route 53 | Route 160M transactions globally, failover | HIGH — critical path |
| AWS Cloud WAN | Connect 15+ regions + on-prem, IP management | HIGH — network backbone |
| IP addressing | On-prem exhaustion, RFC 1918, IPv6 | HIGH — everything depends on this |
| PCI-DSS | Every payment system touched must comply | HIGH — compliance risk |
| Proprietary HSMs | Card encryption, PIN verification | MEDIUM — deep expertise in specialist team |
| Backstage | Developer experience for 1000+ engineers | MEDIUM — build templates |
| Synthetic Monitoring | Prove payment SLAs 24/7 before users are impacted | MEDIUM — build canaries |
| ISO 8583 | Understand what you're protecting | LOW — awareness only |
| Authorization/Clearing/Settlement | Context for all technical decisions | LOW — awareness only |

---

## Quick Reference — Acronyms You'll Hear Daily

| Acronym | Full Name | Context |
|---|---|---|
| PAN | Primary Account Number | The 16-digit card number |
| BIN | Bank Identification Number | First 6-8 digits — identifies the bank |
| PCI-DSS | Payment Card Industry Data Security Standard | Compliance framework |
| HSM | Hardware Security Module | Physical device that manages crypto keys |
| FIPS | Federal Information Processing Standard | HSM certification level |
| LMK | Local Master Key | Top of the key hierarchy, never leaves HSM |
| ISO 8583 | International Standard for financial messages | The language of payments |
| STAN | Systems Trace Audit Number | Unique ID for each transaction |
| SLA | Service Level Agreement | 99.999% uptime, < 500ms latency |
| WAN | Wide Area Network | Connects offices/regions/clouds |
| BGP | Border Gateway Protocol | How internet/network routing works |
| Anycast | Same IP from multiple locations | How Smart DNS gets traffic to nearest PoP |
| CDK | Cloud Development Kit | AWS infrastructure as TypeScript code |
| ASG | Auto Scaling Group | Automatic EC2 fleet management |
| ALB | Application Load Balancer | Distributes traffic |
| VPC | Virtual Private Cloud | Your private network in AWS |
| CIDR | Classless Inter-Domain Routing | IP range notation (10.0.0.0/16) |
| PCI PoP | Point of Presence | Physical network location |

---

*Document for Ganesh Lohar — Mastercard Platform Team Onboarding*
*Account: 824033490704 | Region: us-east-1 | Date: 2026-04-24*
