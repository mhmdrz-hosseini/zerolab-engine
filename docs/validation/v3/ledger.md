# V3 execution ledger

Baseline: c51aa9bd4d76ca5b496876dd8cc21f23512b4da7.
Dependency lock SHA256: ECAF7065639A1DACE51E1C72F30FC24E485EBA0C69E26633328483D650FBF37D.
Sandbox: D:/code/3d/MOLD/mold-reliability-worktree, branch codex/mold-v3-reliability.
Previous checkout was clean, with no matching live Node/Python process. Reused it without deleting its old branch or history.

T01 in progress: frozen acceptance contract copied; synthetic fixtures and materials/relief behavioral tests added. Full runner and real-case matrix remain pending.
T02 next: demonstrate red material accounting tests before changing production code.

T02 implemented: both materials tests failed on V2 (freeboard altered silicone volume; 1 cm3 produced a 1000 mL warning), then passed after separating fill height and correcting units. Net-volume regression passed. Build passed with existing Vite bundle/node-module warnings. Tray fill/freeboard is now exported and documented. Logs: OUTPUT/v3/baseline/materials-red.log and relief-red.log. T05/T06 relief assertions remain intentionally red until geometry is corrected.

Ruling: the broad digital goal remains active across checkpoints. Initial changes are developed only in the sandbox; they are not yet integrated into main or counted as complete platform acceptance.
