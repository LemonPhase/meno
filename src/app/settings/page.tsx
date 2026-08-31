import { modelName } from "@/ai/model";
import AccountSetting from "@/components/auth/AccountSetting";
import ThemeSetting from "@/components/shell/ThemeSetting";

// Settings v1 (by design decision): the account, the reading theme, and —
// visible in dev — which engine is answering. Nothing else until there is
// something else worth setting.

export default function SettingsPage() {
  const scripted = modelName === "scripted";

  return (
    <div className="page fade-in">
      <span className="kicker sc">Preferences</span>
      <h1 className="h-display">Settings</h1>

      <div style={{ marginTop: 34 }}>
        <div className="setrow">
          <span className="k">Account</span>
          <div>
            <AccountSetting />
          </div>
        </div>

        <div className="setrow">
          <span className="k">Reading theme</span>
          <div>
            <ThemeSetting />
            <p className="d">
              Paper and Night, or follow your system. Stored in this browser
              only.
            </p>
          </div>
        </div>

        <div className="setrow">
          <span className="k">Engine</span>
          <div>
            <span style={{ fontSize: 16 }}>
              {scripted ? "Scripted (dev fake — no model calls)" : modelName}
            </span>
            <p className="d">
              Set with the MENO_MODEL environment variable at start-up;
              &ldquo;scripted&rdquo; swaps in the test fake for dogfooding
              without network calls.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
