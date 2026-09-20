"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchHistory = void 0;
const STATE_ID = 'searchHistory';
const MAX_ENTRIES = 10;
/** Keep literal search text, but ignore empty entries and case-insensitive duplicates. */
function normalizeHistory(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    return value
        .filter((entry) => {
        if (typeof entry !== 'string' || !entry.trim() || seen.has(entry.toLowerCase())) {
            return false;
        }
        seen.add(entry.toLowerCase());
        return true;
    })
        .slice(0, MAX_ENTRIES);
}
function normalizeSnapshot(value) {
    // 1.0.0 and earlier stored only the array. Its first entry was also the last search.
    if (Array.isArray(value)) {
        const entries = normalizeHistory(value);
        return { entries, lastSearch: entries[0] || '' };
    }
    if (!value || typeof value !== 'object') {
        return { entries: [], lastSearch: '' };
    }
    const stored = value;
    const entries = normalizeHistory(stored.entries);
    const lastSearch = typeof stored.lastSearch === 'string' && stored.lastSearch.trim() ? stored.lastSearch : '';
    return { entries, lastSearch };
}
/** Persist in the adapter namespace; serialize read-modify-write operations across browsers. */
class SearchHistory {
    adapter;
    queue = Promise.resolve();
    objectCreated = false;
    constructor(adapter) {
        this.adapter = adapter;
    }
    get() {
        return this.enqueue(() => this.read());
    }
    remember(searchText) {
        return this.enqueue(async () => {
            const current = await this.read();
            if (typeof searchText !== 'string') {
                return current;
            }
            const lastSearch = searchText.trim() ? searchText : '';
            const entries = lastSearch ? normalizeHistory([searchText, ...current.entries]) : current.entries;
            const next = { entries, lastSearch };
            if (JSON.stringify(next) !== JSON.stringify(current)) {
                await this.adapter.setStateAsync(STATE_ID, { val: JSON.stringify(next), ack: true });
            }
            return next;
        });
    }
    enqueue(operation) {
        const result = this.queue.then(operation);
        // A failed write must not poison the queue for later requests.
        this.queue = result.catch(() => undefined);
        return result;
    }
    async read() {
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
            const empty = { entries: [], lastSearch: '' };
            await this.adapter.setStateAsync(STATE_ID, { val: JSON.stringify(empty), ack: true });
            return empty;
        }
        try {
            return normalizeSnapshot(typeof state.val === 'string' ? JSON.parse(state.val) : null);
        }
        catch {
            // A malformed stored value must not prevent searching or saving the next query.
            return { entries: [], lastSearch: '' };
        }
    }
}
exports.SearchHistory = SearchHistory;
//# sourceMappingURL=searchHistory.js.map