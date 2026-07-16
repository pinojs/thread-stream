# Security Policy

This document describes how vulnerabilities are handled for the
`thread-stream` project.

## The thread-stream threat model

`thread-stream` sends string data from a Node.js application to an
application-selected writable stream running in a Worker Thread. Understanding
what `thread-stream` considers a security vulnerability requires understanding
these trust boundaries.

This threat model extends and incorporates the
[Node.js threat model](https://github.com/nodejs/node/blob/main/SECURITY.md#the-nodejs-threat-model).
The Node.js threat model applies to the runtime, operating system, filesystem,
loaded code, and application-provided inputs. The assumptions below describe
the additional boundaries introduced by `thread-stream`; both models should be
read together.

### Architecture and trust boundaries

Data passed to `write()` is encoded as UTF-8 in the main thread, copied through
a `SharedArrayBuffer`, decoded in the worker, and written to the configured
destination stream. Lifecycle and flush operations use shared atomic state and
messages between the main thread and worker.

A Worker Thread is an execution-isolation mechanism, **not a security sandbox**.
The configured worker module executes trusted application code with the
privileges available to the Node.js process. It can access Node.js APIs, loaded
dependencies, the process environment, the filesystem, and the network subject
to controls imposed by Node.js and the operating system.

`thread-stream` trusts:

* The application and all code it loads, including the configured worker module,
  destination stream, and dependencies.
* Constructor options supplied by the application, including `filename`,
  `workerData`, and `workerOpts`.
* Messages sent by the application to its worker and events sent by the
  configured worker to the application.
* The Node.js runtime, operating system, filesystem, deployment configuration,
  and other elements trusted by the Node.js threat model.
* The application to validate configuration, restrict data volume, observe
  backpressure, handle errors, and choose a destination appropriate for the
  sensitivity of the data.

Within `thread-stream` itself, the contents of correctly supplied string data
are treated as payload rather than control messages. Payload content must not,
by itself, alter the internal worker protocol or cause undocumented code to be
executed. Once delivered, however, the destination is responsible for how it
interprets that content.

### Security properties and limitations

When its public API is used correctly, `thread-stream` is expected to preserve
the ordering and integrity of string data across its main-thread/worker
protocol and to fail without violating application confidentiality, integrity,
or availability.

`thread-stream` does not sanitize, redact, escape, authenticate, authorize, or
encrypt data. In particular, applications must not pass secrets in payloads or
`workerData` unless the configured worker and destination are authorized to
receive them. Applications must sanitize untrusted content when the destination
format or downstream system requires it.

The following may be considered `thread-stream` vulnerabilities:

* Payload content causing arbitrary code execution, protocol-message injection,
  or unexpected modification of shared protocol state without control of the
  application, worker module, or destination.
* A protocol flaw that discloses or corrupts data outside the documented data
  flow when the API is used correctly.
* A deterministic crash, deadlock, or disproportionate unbounded resource
  consumption caused by a small payload under normal, correct use.
* Undocumented loading of code or configuration that was not requested by the
  application.

The following are generally outside this threat model:

* Code execution resulting from an attacker being allowed to choose `filename`,
  `workerOpts`, application messages, or other executable configuration.
* Malicious or compromised application code, worker modules, destination
  streams, dependencies, the Node.js runtime, the operating system, or the
  filesystem.
* A configured worker modifying the shared state or sending forged, malformed,
  or dangerous events. The worker is trusted and is not isolated as an
  adversarial component.
* Injection or other side effects caused by a destination or downstream system
  interpreting delivered payload content.
* Disclosure of data intentionally written to the configured destination or
  supplied through `workerData`.
* Resource exhaustion caused by unbounded application writes, ignored
  backpressure, a slow or non-draining destination, or a destination that does
  not follow the documented stream lifecycle.
* Crashes caused by application code failing to handle documented errors or by
  trusted callbacks, event handlers, workers, or destinations throwing.

A vulnerability in Node.js itself should be reported according to the
[Node.js security policy](https://github.com/nodejs/node/blob/main/SECURITY.md).
A vulnerability in a configured worker module or destination should be reported
to that module's maintainers.

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Report it privately
through [GitHub Security Advisories](https://github.com/pinojs/thread-stream/security/advisories/new).

Include, when possible:

* The affected `thread-stream` and Node.js versions.
* The operating system and relevant configuration.
* A minimal proof of concept and clear reproduction steps.
* The expected and actual behavior.
* The potential impact and the trust assumptions required for exploitation.

Please use an isolated, controlled environment and do not test against systems
or data you do not own or have permission to use.

### Report quality

Please submit a report when there is a concrete reason to believe the behavior
is a security vulnerability under the threat model above. Reports about normal
bugs, hardening opportunities, or scenarios that require control of a trusted
component may be handled through the public issue tracker after any sensitive
details have been removed.

## Handling vulnerability reports

When a potential vulnerability is reported, the following actions are taken.

### Triage

**Target:** 5 business days

Within 5 business days, a maintainer will provide an initial response. The
possible responses are:

* **Acceptance:** the report is considered a vulnerability.
* **Rejection:** the report is not considered a vulnerability, with an
  explanation when possible.
* **More information needed:** additional details are required to evaluate the
  report.

The affected versions and initial severity will be assessed during triage.

### Correction follow-up

**Target:** 90 days

For an accepted vulnerability, a maintainer will coordinate the fix and release
with the reporter and any affected upstream or downstream maintainers. The goal
is to publish a patched release before disclosing full vulnerability details.

The advisory's vulnerable-version range will end at the last vulnerable
version when a fix is available, or remain open-ended if no fixed version is
available at publication time.

### Publication

**Target:** within 90 days after triage

The GitHub Security Advisory will normally be published within 90 days after
triage. Severity will be assessed using
[CVSS v3.1](https://www.first.org/cvss/v3-1/), and a CVE will be requested when
appropriate.

If a fix is actively being developed, the publication date may be extended with
the agreement of the maintainers and reporter. The reporter will be credited
unless they request otherwise.
