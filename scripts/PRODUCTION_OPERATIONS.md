# Production Operations Scripts

These scripts are retained production audit and migration tools. They load
credentials from the runtime environment; credentials are never embedded.

## Read-Only Audits

- auditPostWalletMigrationActivity.js
- auditProductionReadConsistency.js
- auditProductionRecycleMechanism.js
- auditWalletMigrationInventory.js
- auditWalletReplacementDatabaseImpact.js
- classifyProductionRecycleBoundaries.js
- inspectProductionUpgradeInventory.js
- verifyInactiveLevelSuspectsOnChain.js
- verifyWalletReplacementDatabasePostState.js
- verifyWalletReplacementDatabaseProjection.js
- verifyWalletReplacementOrbitSnapshotWindow.js

## Evidence Builders

- buildProductionMatrixParentLedger.js
- exportWalletReplacementDescendantEdges.js
- exportWalletReplacementOrbitKeys.js

## State-Changing Migration Tools

- migrateProductionWalletIdentities.js
- rollbackProductionWalletIdentities.js

The state-changing tools must not be run as ordinary diagnostics. The migration
defaults to dry-run behavior unless EXECUTE=true. The rollback additionally
requires the exact CONFIRM_ROLLBACK_MIGRATION_ID value. Both refuse a database
whose name is not finfreedom.

Before any future execution:

1. create a current database backup,
2. run the impact and projection scripts,
3. compare the frozen identity manifest,
4. verify the target chain and contract addresses,
5. record the operator, time, command, and resulting report,
6. run all post-state verification scripts.
