//! Pure domain logic for Runs: statuses, modes, and the closed transition
//! table (ADR-002/003). No DB, no IO — everything here is a `match`.

/// Lifecycle status of a Run (ADR-002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RunStatus {
    Draft,
    Provisioning,
    Ready,
    Running,
    Verifying,
    Paused,
    Blocked,
    Completed,
    Failed,
    Cancelled,
}

/// Execution mode of a Run (ADR-003 §Execution modes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RunMode {
    Interactive,
    Delegated,
    Chat,
}

impl RunStatus {
    /// All ten variants, in a fixed order — used to drive exhaustive sweeps.
    pub const ALL: [RunStatus; 10] = [
        RunStatus::Draft,
        RunStatus::Provisioning,
        RunStatus::Ready,
        RunStatus::Running,
        RunStatus::Verifying,
        RunStatus::Paused,
        RunStatus::Blocked,
        RunStatus::Completed,
        RunStatus::Failed,
        RunStatus::Cancelled,
    ];

    /// Whether `next` is a legal transition target from `self`. Exact table
    /// from the plan (ADR-002 §Run transitions) — everything else is
    /// rejected.
    pub fn can_transition_to(self, next: RunStatus) -> bool {
        use RunStatus::*;
        matches!(
            (self, next),
            (Draft, Provisioning)
                | (Draft, Cancelled)
                | (Provisioning, Ready)
                | (Provisioning, Failed)
                | (Provisioning, Cancelled)
                | (Ready, Running)
                | (Ready, Cancelled)
                | (Running, Verifying)
                | (Running, Paused)
                | (Running, Blocked)
                | (Running, Failed)
                | (Running, Cancelled)
                | (Verifying, Completed)
                | (Verifying, Running)
                | (Verifying, Blocked)
                | (Verifying, Failed)
                | (Verifying, Cancelled)
                | (Paused, Running)
                | (Paused, Failed)
                | (Paused, Cancelled)
                | (Blocked, Running)
                | (Blocked, Failed)
                | (Blocked, Cancelled)
        )
    }

    /// Terminal states allow no further transitions.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
        )
    }

    /// The exact string stored in the `runs.status` / `run_transitions`
    /// columns — must match the SQL `CHECK` constraint verbatim.
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Draft => "draft",
            RunStatus::Provisioning => "provisioning",
            RunStatus::Ready => "ready",
            RunStatus::Running => "running",
            RunStatus::Verifying => "verifying",
            RunStatus::Paused => "paused",
            RunStatus::Blocked => "blocked",
            RunStatus::Completed => "completed",
            RunStatus::Failed => "failed",
            RunStatus::Cancelled => "cancelled",
        }
    }

    /// Parse the SQL column value back into a `RunStatus`. `None` for
    /// anything that isn't one of the ten known strings.
    pub fn parse(s: &str) -> Option<RunStatus> {
        match s {
            "draft" => Some(RunStatus::Draft),
            "provisioning" => Some(RunStatus::Provisioning),
            "ready" => Some(RunStatus::Ready),
            "running" => Some(RunStatus::Running),
            "verifying" => Some(RunStatus::Verifying),
            "paused" => Some(RunStatus::Paused),
            "blocked" => Some(RunStatus::Blocked),
            "completed" => Some(RunStatus::Completed),
            "failed" => Some(RunStatus::Failed),
            "cancelled" => Some(RunStatus::Cancelled),
            _ => None,
        }
    }
}

impl RunMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RunMode::Interactive => "interactive",
            RunMode::Delegated => "delegated",
            RunMode::Chat => "chat",
        }
    }

    pub fn parse(s: &str) -> Option<RunMode> {
        match s {
            "interactive" => Some(RunMode::Interactive),
            "delegated" => Some(RunMode::Delegated),
            "chat" => Some(RunMode::Chat),
            _ => None,
        }
    }
}

/// Access level a Run holds over a `WorktreeBinding` grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Access {
    Read,
    Write,
}

impl Access {
    /// The exact string stored in `run_worktree_grants.access` — must match
    /// the SQL `CHECK` constraint verbatim.
    pub fn as_str(self) -> &'static str {
        match self {
            Access::Read => "read",
            Access::Write => "write",
        }
    }

    pub fn parse(s: &str) -> Option<Access> {
        match s {
            "read" => Some(Access::Read),
            "write" => Some(Access::Write),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact legal-edge set from the plan's transition table, as
    /// (from, to) pairs. Any change to `can_transition_to` that isn't also
    /// reflected here fails the exhaustive sweep below — that's the point:
    /// adding a status later forces this constant to be revisited.
    const LEGAL_EDGES: &[(RunStatus, RunStatus)] = {
        use RunStatus::*;
        &[
            (Draft, Provisioning),
            (Draft, Cancelled),
            (Provisioning, Ready),
            (Provisioning, Failed),
            (Provisioning, Cancelled),
            (Ready, Running),
            (Ready, Cancelled),
            (Running, Verifying),
            (Running, Paused),
            (Running, Blocked),
            (Running, Failed),
            (Running, Cancelled),
            (Verifying, Completed),
            (Verifying, Running),
            (Verifying, Blocked),
            (Verifying, Failed),
            (Verifying, Cancelled),
            (Paused, Running),
            (Paused, Failed),
            (Paused, Cancelled),
            (Blocked, Running),
            (Blocked, Failed),
            (Blocked, Cancelled),
        ]
    };

    #[test]
    fn every_legal_edge_from_the_table_is_accepted() {
        for &(from, to) in LEGAL_EDGES {
            assert!(
                from.can_transition_to(to),
                "expected {:?} -> {:?} to be legal",
                from,
                to
            );
        }
    }

    #[test]
    fn exhaustive_sweep_matches_the_legal_set_exactly() {
        for &from in RunStatus::ALL.iter() {
            for &to in RunStatus::ALL.iter() {
                let expected = LEGAL_EDGES.contains(&(from, to));
                let actual = from.can_transition_to(to);
                assert_eq!(
                    actual, expected,
                    "can_transition_to mismatch for {:?} -> {:?}: got {}, want {}",
                    from, to, actual, expected
                );
            }
        }
    }

    #[test]
    fn terminal_states_allow_no_transitions() {
        for &terminal in &[
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ] {
            assert!(terminal.is_terminal());
            for &to in RunStatus::ALL.iter() {
                assert!(
                    !terminal.can_transition_to(to),
                    "terminal state {:?} must not transition to {:?}",
                    terminal,
                    to
                );
            }
        }
    }

    #[test]
    fn non_terminal_states_are_not_terminal() {
        for &s in &[
            RunStatus::Draft,
            RunStatus::Provisioning,
            RunStatus::Ready,
            RunStatus::Running,
            RunStatus::Verifying,
            RunStatus::Paused,
            RunStatus::Blocked,
        ] {
            assert!(!s.is_terminal());
        }
    }

    #[test]
    fn as_str_round_trips_through_parse_for_every_status() {
        for &s in RunStatus::ALL.iter() {
            assert_eq!(RunStatus::parse(s.as_str()), Some(s));
        }
    }

    #[test]
    fn parse_rejects_unknown_strings() {
        assert_eq!(RunStatus::parse("bogus"), None);
        assert_eq!(RunStatus::parse(""), None);
    }

    #[test]
    fn run_mode_round_trips_through_parse() {
        for &m in &[RunMode::Interactive, RunMode::Delegated, RunMode::Chat] {
            assert_eq!(RunMode::parse(m.as_str()), Some(m));
        }
        assert_eq!(RunMode::parse("bogus"), None);
    }

    #[test]
    fn access_round_trips_through_parse() {
        for &a in &[Access::Read, Access::Write] {
            assert_eq!(Access::parse(a.as_str()), Some(a));
        }
        assert_eq!(Access::parse("bogus"), None);
    }
}
