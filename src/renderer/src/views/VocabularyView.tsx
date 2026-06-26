import { Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import type { AppStateSnapshot, VocabularyEntry } from "../../../shared/types";
import { View } from "../components/View";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Panel } from "../components/ui/Panel";
import { useAutoAnimateRef } from "../hooks/useAutoAnimateRef";
import { makeClientId } from "../lib/ids";
import { useMurmurStore } from "../state/murmur-store";

export function VocabularyView({ state }: { state: AppStateSnapshot }): JSX.Element {
  const setVocabulary = useMurmurStore((store) => store.setVocabulary);
  const [word, setWord] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vocabularyParent = useAutoAnimateRef<HTMLDivElement>();
  const vocabulary = state.vocabulary.filter((entry) => entry.term.trim().length > 0);

  useEffect(() => {
    setError(null);
  }, [state.vocabulary]);

  const persistVocabulary = async (entries: VocabularyEntry[]): Promise<boolean> => {
    setIsSaving(true);
    setError(null);

    try {
      await setVocabulary(normalizeVocabulary(entries));
      return true;
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : String(persistError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const addWord = async (): Promise<void> => {
    const term = word.trim();
    if (!term) return;

    const alreadyExists = state.vocabulary.some((entry) => entry.term.trim().toLocaleLowerCase() === term.toLocaleLowerCase());
    if (alreadyExists) {
      setWord("");
      return;
    }

    const didPersist = await persistVocabulary([
      ...state.vocabulary,
      {
        id: makeClientId("term"),
        term,
        pronunciation: "",
        category: "",
        notes: "",
        enabled: true
      }
    ]);
    if (didPersist) setWord("");
  };

  const removeWord = async (entryId: string): Promise<void> => {
    await persistVocabulary(state.vocabulary.filter((entry) => entry.id !== entryId));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void addWord();
  };

  return (
    <View title="Vocabulary">
      <Panel>
        <form onSubmit={submit} className="flex max-w-xl items-center gap-2">
          <Input
            aria-label="Word"
            value={word}
            onChange={(event) => setWord(event.target.value)}
            placeholder="Add a word"
            disabled={isSaving}
          />
          <IconButton title="Add word" type="submit" disabled={isSaving || !word.trim()}>
            <Plus size={18} />
          </IconButton>
        </form>

        <div ref={vocabularyParent} className="mt-4 flex flex-wrap gap-2">
          {vocabulary.length === 0 && <p className="m-0 text-sm text-muted-foreground">No words yet.</p>}
          {vocabulary.map((entry) => (
            <span
              key={entry.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-sm text-foreground"
            >
              <span className="min-w-0 overflow-wrap-anywhere">{entry.term}</span>
              <button
                type="button"
                title={`Remove ${entry.term}`}
                aria-label={`Remove ${entry.term}`}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/35"
                onClick={() => void removeWord(entry.id)}
                disabled={isSaving}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>

        {error && <p className="mt-3 mb-0 text-xs text-danger">{error}</p>}
      </Panel>
    </View>
  );
}

function normalizeVocabulary(entries: VocabularyEntry[]): VocabularyEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      term: entry.term.trim(),
      enabled: true
    }))
    .filter((entry) => entry.term.length > 0);
}
