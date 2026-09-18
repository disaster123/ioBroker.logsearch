type HistoryAdapter = Pick<ioBroker.Adapter, 'getStateAsync' | 'setStateAsync' | 'setObjectNotExistsAsync'>;

const STATE_ID = 'searchHistory';
const MAX_ENTRIES = 10;

/** Keep literal search text, but ignore empty entries and case-insensitive duplicates. */
function normalizeHistory(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    return value
        .filter((entry): entry is string => {
            if (typeof entry !== 'string' || !entry.trim() || seen.has(entry.toLowerCase())) {
                return false;
            }
            seen.add(entry.toLowerCase());
            return true;
        })
        .slice(0, MAX_ENTRIES);
}

/** Persist in the adapter namespace; serialize read-modify-write operations across browsers. */
export class SearchHistory {
    private queue: Promise<unknown> = Promise.resolve();
    private objectCreated = false;

    constructor(private readonly adapter: HistoryAdapter) {}

    get(): Promise<string[]> {
        return this.enqueue(() => this.read());
    }

    remember(searchText: unknown): Promise<string[]> {
        return this.enqueue(async () => {
            const history = await this.read();
            const next = normalizeHistory([searchText, ...history]);
            if (JSON.stringify(next) !== JSON.stringify(history)) {
                await this.adapter.setStateAsync(STATE_ID, { val: JSON.stringify(next), ack: true });
            }
            return next;
        });
    }

    private enqueue(operation: () => Promise<string[]>): Promise<string[]> {
        const result = this.queue.then(operation);
        // A failed write must not poison the queue for later requests.
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async read(): Promise<string[]> {
        if (!this.objectCreated) {
            await this.adapter.setObjectNotExistsAsync(STATE_ID, {
                type: 'state',
                common: { name: 'Recent searches', type: 'string', role: 'json', read: true, write: false },
                native: {},
            });
            this.objectCreated = true;
        }
        const state = await this.adapter.getStateAsync(STATE_ID);
        if (state?.val == null) {
            await this.adapter.setStateAsync(STATE_ID, { val: '[]', ack: true });
            return [];
        }
        try {
            return normalizeHistory(typeof state.val === 'string' ? JSON.parse(state.val) : null);
        } catch {
            // A malformed stored value must not prevent searching or saving the next query.
            return [];
        }
    }
}
