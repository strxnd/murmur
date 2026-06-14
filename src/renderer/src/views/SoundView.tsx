import { Save } from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { Metric } from "../components/Metric";
import { View } from "../components/View";
import { Button } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
import { Switch } from "../components/ui/Switch";
import { Toolbar } from "../components/ui/Toolbar";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { useMurmurStore } from "../state/murmur-store";

export function SoundView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const updateSettings = useMurmurStore((store) => store.updateSettings);
  const [autoIncreaseMicVolume, setAutoIncreaseMicVolume] = useState(state.settings.autoIncreaseMicVolume);
  const diagnosticsParent = useAutoAnimateRef<HTMLDivElement>();

  useEffect(() => {
    setAutoIncreaseMicVolume(state.settings.autoIncreaseMicVolume);
  }, [state.settings.autoIncreaseMicVolume]);

  const dirty = autoIncreaseMicVolume !== state.settings.autoIncreaseMicVolume;

  return (
    <View
      title="Sound"
      actions={
        <Toolbar>
          <Button
            variant="primary"
            disabled={!dirty}
            onClick={() => void updateSettings({ autoIncreaseMicVolume })}
          >
            <Save size={18} /> Save
          </Button>
        </Toolbar>
      }
    >
      <section className="grid grid-cols-[minmax(0,1fr)_24rem] gap-4 max-[980px]:grid-cols-1">
        <Panel title="Recording">
          <div className="flex flex-col gap-4">
            <Switch
              label="Automatically increase microphone volume"
              checked={autoIncreaseMicVolume}
              onCheckedChange={setAutoIncreaseMicVolume}
              className="rounded-md border border-border bg-muted/20 p-3"
            />
            <div className="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
              <Metric label="wpctl" value={state.capabilities.sound.wpctlAvailable ? "available" : "unavailable"} />
              <Metric label="pactl" value={state.capabilities.sound.pactlAvailable ? "available" : "unavailable"} />
            </div>
          </div>
        </Panel>

        <Panel title="Diagnostics">
          <div ref={diagnosticsParent} className="flex flex-col gap-2 text-sm text-muted-foreground">
            {state.capabilities.sound.diagnostics.map((diagnostic, index) => (
              <p key={`${diagnostic}-${index}`} className="m-0">
                {diagnostic}
              </p>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Sound Effects">
        <p className="m-0 text-sm text-muted-foreground">Sound effects are not implemented yet.</p>
      </Panel>
    </View>
  );
}
