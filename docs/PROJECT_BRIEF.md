# VyaparBoss — project brief (condensed)

Full brief lives in the claude.ai Project "Export Supply Chain". This is the working summary for development.

**Parent:** House of 24 Private Limited · **Market:** India · **Stage:** concept / pre-MVP
**Customers:** MSMEs — manufacturers, wholesalers, retailers, distributors, agribusinesses.

## Problem
Procurement is fragmented and manual (phone, WhatsApp, spreadsheets). Buyers can't compare true delivered cost across MOQs, freight and taxes; supplier reliability is hard to judge; logistics is disconnected from sourcing. IndiaMART / JD Mart solve discovery, not execution.

## Product
Tell VyaparBoss what you need; it handles sourcing, quotes, comparison, negotiation, PO and delivery tracking.

Components: (A) AI procurement assistant · (B) verified supplier marketplace · (C) AI supplier/sales assistant · (D) transaction and PO management · (E) logistics via 3PL partners first.

## Agent architecture
1. Buyer Intelligence — interprets request, finds missing specs, builds structured requirement
2. Supplier Discovery — matches catalogue, credentials, capacity, coverage
3. RFQ & Negotiation — requests quotes, negotiates within approved limits
4. Procurement Optimization — ranks on total landed cost and fulfillment suitability
5. Fulfillment Coordination — confirmation, tracking, exceptions
6. Supplier Intelligence — learns from transaction history

Uses existing LLMs + structured data + human approval. No custom foundation model.

## Go-to-market
1. Validation: 30–50 buyer interviews in one segment; recruit initial suppliers
2. Concierge pilot via WhatsApp + basic web
3. Digital MVP: accounts, onboarding, AI chat, RFQs, quote comparison, orders, tracking
4. Regional expansion → 5. platform expansion

Launch category candidates: packaging materials or industrial consumables (repeat purchase, standard specs). Agri inputs also in the prototype.

## Revenue
Transaction commission, supplier subscriptions, managed procurement fees, logistics margins. All rates to be validated in pilot.

## Key risks and guardrails
- Two-sided cold start → start with one segment and one cluster
- Thin margins → asset-light, track contribution margin per order
- AI accuracy → ground commercial outputs in verified records; approval before commitments
- Working capital → no speculative inventory or direct lending early
- Regulated categories → start with low-complexity ones

## KPIs
Active and repeat buyers, CAC, AOV · verified suppliers, RFQ→quote and quote→order conversion, GMV, fulfillment rate · take rate, contribution margin · response time, on-time rate, dispute rate · extraction accuracy, human-intervention rate, cost per AI request.
