# Security Policy

This document describes how vulnerabilities are handled for `thread-stream`.

## The `thread-stream` threat model

`thread-stream` sends string data to an application-selected writable stream in
a Node.js Worker Thread. Its threat model builds upon the
[Node.js threat model](https://github.com/nodejs/node/blob/main/SECURITY.md#the-nodejs-threat-model),
whose assumptions also apply.

`thread-stream` trusts the application and its environment. This includes the
configured worker module and destination, dependencies, the Node.js runtime,
the operating system, the filesystem, and application-provided options such as
`filename`, `workerData`, and `workerOpts`. Application and custom worker
messages and events are also trusted.

A Worker Thread is not a security sandbox. The configured worker runs with the
privileges available to the Node.js process.

The application is responsible for validating configuration and input,
observing backpressure, handling errors, and choosing an appropriate
destination. `thread-stream` does not sanitize, redact, escape, authenticate, or
encrypt data.

Correctly supplied string content is payload, not part of the internal worker
protocol. Payload content causing arbitrary code execution, protocol injection,
data corruption or disclosure, or disproportionate resource consumption under
normal use may be considered a vulnerability.

Scenarios requiring control of trusted application configuration, worker code,
the destination, dependencies, or environment are outside this threat model.
This also includes downstream injection, intentional disclosure to the
configured destination, ignored backpressure, and slow or non-draining
destinations.

Report vulnerabilities in Node.js according to the
[Node.js security policy](https://github.com/nodejs/node/blob/main/SECURITY.md),
and vulnerabilities in configured worker modules or destinations to their
maintainers.

## Reporting vulnerabilities

Do not open a public issue. Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/pinojs/thread-stream/security/advisories/new).

Include the affected `thread-stream` and Node.js versions, relevant
configuration, impact, reproduction steps, and a minimal proof of concept. Test
only in isolated environments you own or have permission to use.

## Handling vulnerability reports

### Triage

**Target:** 5 business days

A maintainer will respond with an acceptance, rejection, or request for more
information. Accepted reports will be assessed for affected versions and
severity.

### Correction follow-up

**Target:** 90 days

Maintainers will coordinate a fix and release with the reporter and any affected
upstream or downstream maintainers. The goal is to release a patch before full
disclosure.

### Publication

**Target:** within 90 days after triage

The GitHub Security Advisory will normally be published within 90 days. Severity
will be assessed using [CVSS v3.1](https://www.first.org/cvss/v3-1/), and a CVE
will be requested when appropriate. Publication may be extended by agreement
while a fix is actively being developed. Reporters will be credited unless they
request otherwise.
