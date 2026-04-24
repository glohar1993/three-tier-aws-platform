#!/usr/bin/env node

// ============================================================================
// THREE-TIER AWS ARCHITECTURE — CDK Entry Point
// ============================================================================
//
// ARCHITECTURE OVERVIEW:
//
//   Internet → ALB (Tier 1, Public Subnets)
//                ↓  [only ALB SG allowed]
//            EC2 ASG (Tier 2, Private Subnets)
//                ↓  [only App SG allowed, port 3306]
//            RDS MySQL (Tier 3, Isolated Subnets)
//
// STACK DEPENDENCY CHAIN:
//   NetworkStack                     (no deps — creates VPC + SGs)
//     ↓
//   PresentationStack (needs: vpc, albSg)
//     ↓
//   ApplicationStack  (needs: vpc, appSg, targetGroup)
//   DataStack         (needs: vpc, dbSg)   ← parallel with ApplicationStack
//
// HOW CDK WORKS:
//   1. `cdk synth`  → CDK synthesizes each stack into a CloudFormation template
//   2. `cdk deploy` → CDK uploads templates to S3 and calls CloudFormation
//   3. CloudFormation creates resources in parallel where possible,
//      respecting dependencies between stacks.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { PresentationStack } from '../lib/presentation-stack';
import { ApplicationStack } from '../lib/application-stack';
import { DataStack } from '../lib/data-stack';

const app = new cdk.App();

// Target AWS account and region
// These are read from your environment (AWS_ACCOUNT_ID / AWS_DEFAULT_REGION)
// or can be hardcoded: { account: '123456789012', region: 'us-east-1' }
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// ============================================================================
// STACK 1 — NETWORK (Foundation)
// ============================================================================
// Creates: VPC, 9 subnets (3 public + 3 private + 3 isolated), 3 NAT Gateways,
//          Internet Gateway, Security Groups (alb/app/db), VPC Flow Logs
//
// Think of this as the blueprint for your data center:
//   - Public subnets  = DMZ (only the load balancer lives here)
//   - Private subnets = Internal servers (EC2, never public-facing)
//   - Isolated subnets= Vault (databases, completely air-gapped from internet)
const networkStack = new NetworkStack(app, 'NetworkStack', {
  env,
  description: 'Three-Tier VPC: subnets, NAT Gateways, Security Groups',
  tags: {
    Project: 'ThreeTierApp',
    Tier: 'Network',
    ManagedBy: 'CDK',
  },
});

// ============================================================================
// STACK 2 — PRESENTATION (Tier 1)
// ============================================================================
// Creates: Application Load Balancer (public), Target Group, HTTP Listener,
//          S3 bucket for ALB access logs
//
// The ALB is the ONLY resource with a public DNS name.
// All internet traffic enters here and gets distributed to healthy EC2 instances.
const presentationStack = new PresentationStack(app, 'PresentationStack', {
  env,
  description: 'Three-Tier Presentation: ALB, Listener, Target Group',
  network: networkStack,
  tags: {
    Project: 'ThreeTierApp',
    Tier: 'Presentation',
    ManagedBy: 'CDK',
  },
});
// Explicit dependency: PresentationStack needs VPC and SGs from NetworkStack
presentationStack.addDependency(networkStack);

// ============================================================================
// STACK 3 — APPLICATION (Tier 2)
// ============================================================================
// Creates: EC2 Launch Template, Auto Scaling Group (min 2, max 6),
//          IAM Role (SSM + CloudWatch + Secrets Manager), CPU scaling policy,
//          CloudWatch Alarms
//
// EC2 instances are in PRIVATE subnets — no public IPs, never directly reachable.
// Access via: AWS Systems Manager Session Manager (no SSH, no bastion host).
const applicationStack = new ApplicationStack(app, 'ApplicationStack', {
  env,
  description: 'Three-Tier Application: EC2 ASG, Launch Template, IAM',
  network: networkStack,
  presentation: presentationStack,
  tags: {
    Project: 'ThreeTierApp',
    Tier: 'Application',
    ManagedBy: 'CDK',
  },
});
applicationStack.addDependency(presentationStack);

// ============================================================================
// STACK 4 — DATA (Tier 3)
// ============================================================================
// Creates: Secrets Manager secret (auto-generated MySQL password),
//          RDS Subnet Group, RDS Parameter Group,
//          RDS MySQL 8.0 Multi-AZ (Primary + Standby),
//          CloudWatch Alarms (CPU, storage, connections)
//
// RDS is in ISOLATED subnets — zero internet route.
// Reachable ONLY from App tier EC2 instances via dbSg on port 3306.
const dataStack = new DataStack(app, 'DataStack', {
  env,
  description: 'Three-Tier Data: RDS MySQL Multi-AZ, Secrets Manager',
  network: networkStack,
  tags: {
    Project: 'ThreeTierApp',
    Tier: 'Data',
    ManagedBy: 'CDK',
  },
});
// DataStack only needs NetworkStack (VPC + dbSg) — it's independent from App/Presentation
dataStack.addDependency(networkStack);

// Tag the entire app — these tags appear on every resource in every stack
cdk.Tags.of(app).add('Application', 'ThreeTierArchitecture');
cdk.Tags.of(app).add('Environment', 'Production');
