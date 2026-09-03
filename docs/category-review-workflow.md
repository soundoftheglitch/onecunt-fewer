# Daily category workflow

The 23:00 snapshot publisher updates the public archive, classifies only new or changed threads with local Ollama, rebuilds inherited reply categories, validates the database, and publishes signed immutable SQLite and compact JSON assets. A confidence below 0.68 remains `uncategorised` for review.

The extension verifies the signed compact category map and offers View → Categories. When the logged-in forum identity is `dog hat`, uncategorised rows also show a category selector. Save sends a credential-free decision to the loopback-only review receiver. The next successful nightly publication imports it as a manual assignment; manual assignments always win over AI. The outbox is acknowledged only after GitHub publication succeeds.

The browser never receives GitHub or signing credentials. If AI, validation, signing, upload, or pointer verification fails, the prior remote generation remains active and review decisions remain queued for retry.
