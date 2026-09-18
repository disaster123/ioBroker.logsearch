import { expect } from 'chai';
import * as sinon from 'sinon';

import { SearchHistory } from '../src/lib/searchHistory';

function storage(initial: unknown = null): {
    adapter: Pick<ioBroker.Adapter, 'getStateAsync' | 'setStateAsync' | 'setObjectNotExistsAsync'>;
    write: sinon.SinonStub;
    create: sinon.SinonStub;
} {
    let state = initial;
    const write = sinon.stub().callsFake(async (_id: string, next: unknown) => {
        state = next;
    });
    const create = sinon.stub().resolves();
    return {
        adapter: {
            getStateAsync: sinon.stub().callsFake(async () => state),
            setStateAsync: write,
            setObjectNotExistsAsync: create,
        },
        write,
        create,
    };
}

describe('persistent search history', () => {
    it('creates a JSON state in the adapter namespace without resetting it on restart', async () => {
        const db = storage();
        const history = new SearchHistory(db.adapter);
        expect(await history.get()).to.deep.equal([]);
        expect(db.create.firstCall.args).to.deep.equal([
            'searchHistory',
            {
                type: 'state',
                common: { name: 'Recent searches', type: 'string', role: 'json', read: true, write: false },
                native: {},
            },
        ]);
        await history.remember('mqtt.0');
        expect(await new SearchHistory(db.adapter).get()).to.deep.equal(['mqtt.0']);
        expect(db.write.lastCall.args).to.deep.equal(['searchHistory', { val: '["mqtt.0"]', ack: true }]);
        expect(db.write.callCount).to.equal(2);
    });

    it('keeps the newest ten and moves case-insensitive duplicates to the front', async () => {
        const db = storage();
        const history = new SearchHistory(db.adapter);
        for (let i = 0; i < 12; i++) {
            await history.remember(`term ${i}`);
        }
        const entries = await history.remember('TERM 5');
        expect(entries).to.deep.equal([
            'TERM 5',
            'term 11',
            'term 10',
            'term 9',
            'term 8',
            'term 7',
            'term 6',
            'term 4',
            'term 3',
            'term 2',
        ]);
        await history.remember('TERM 5');
        expect(db.write.callCount).to.equal(14); // initialization + 12 queries + one promotion
    });

    it('ignores invalid and empty input while preserving literal spaces and Unicode', async () => {
        const history = new SearchHistory(storage().adapter);
        for (const input of ['', '  ', null, undefined, 5, {}, ['bad']]) {
            expect(await history.remember(input)).to.deep.equal([]);
        }
        expect(await history.remember(' äöü 雪 ')).to.deep.equal([' äöü 雪 ']);
    });

    it('serializes concurrent browsers without losing entries', async () => {
        const history = new SearchHistory(storage().adapter);
        await Promise.all(['first', 'second', 'third'].map(query => history.remember(query)));
        expect(await history.get()).to.deep.equal(['third', 'second', 'first']);
    });

    it('recovers from malformed state values and normalizes stored arrays', async () => {
        for (const val of ['not json', '{}', 'null', 12]) {
            const history = new SearchHistory(storage({ val }).adapter);
            expect(await history.get()).to.deep.equal([]);
            expect(await history.remember('next')).to.deep.equal(['next']);
        }
        const history = new SearchHistory(storage({ val: '["one",null,"ONE"," ","two"]' }).adapter);
        expect(await history.get()).to.deep.equal(['one', 'two']);
    });

    it('does not report failed writes as saved and retries on the next request', async () => {
        const db = storage({ val: '["old"]' });
        db.write.onFirstCall().rejects(new Error('storage offline'));
        const history = new SearchHistory(db.adapter);
        let error: unknown;
        try {
            await history.remember('lost');
        } catch (caught) {
            error = caught;
        }
        expect(String(error)).to.contain('storage offline');
        expect(await history.remember('retry')).to.deep.equal(['retry', 'old']);
    });
});
