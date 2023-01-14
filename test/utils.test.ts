import * as utils from "../src/utils.js"

describe('test split amounts ', () => {
    test('testing amount 2561', async () => {
        const chunks = utils.splitAmount(2561)
       expect(chunks).toEqual([ 1, 512, 2048 ])
    });
    test('testing amount 0', async () => {
        const chunks = utils.splitAmount(0)
       expect(chunks).toEqual([])
    });
})


describe('', () => {
    test('', async () => {
        // todo
    });
})
