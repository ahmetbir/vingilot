import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Vingilot to finish recovery"
      body="Your identity was updated. Vingilot needs to restart so syncing and agents run under it."
    />
  );
}
