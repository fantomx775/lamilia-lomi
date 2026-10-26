# Community product deletion fence

A hard delete is refused while any community artwork or upload reservation references a book. The check includes pending, removed, soft-deleted and cleaned reservation records. The admin receives an archive-instead-of-delete message; archiving preserves the community history and hides public gallery entries through the existing product status gate.

For an unreferenced book, `community_begin_product_deletion` locks the established per-product advisory lane and product row, verifies references, then stores a durable deletion marker. This is additive: the legacy `delete_product` RPC still accepts pre-merge app calls for unmarked, unreferenced books. Product updates and new community reservations fail while a marker exists.

Only after the marker is committed does the admin wrapper clean curated reader-artwork objects, revoke public R2 assets and clean local persisted media. It then calls `community_finalize_product_deletion`, which rechecks references and public R2 state before delegating to the existing authenticated admin delete. If any cleanup step fails, the marker remains; retrying the admin delete resumes against the still-present product metadata. A marker is removed by the product FK cascade only after the final delete commits.

Local mode stores the same marker beside community profiles, artworks and upload reservations. Marker creation, reservations and local product saves use the shared community JSON file lock, so a stale local catalog save cannot race a new reservation or a pending delete. Local mode does not claim remote database or provider cleanup guarantees.
