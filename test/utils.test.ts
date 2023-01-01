import * as utils from "../src/utils"

describe('test split amounts ', () => {
    test('testing amount 2561', async () => {
        const chunks = utils.splitAmount(2561)
       expect(chunks).toEqual([ 1, 512, 2048 ])
    });
})


describe('', () => {
    test('', async () => {
        // todo
    });
})
