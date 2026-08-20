# D1 repositories

Repositories own prepared D1 statements and row shapes. Routes handle HTTP and rendering; services coordinate business operations; Durable Objects own workflow state. Keep multi-table writes atomic with `DB.batch()` and compose repository-provided statements rather than reintroducing SQL in callers.
