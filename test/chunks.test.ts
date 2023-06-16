import { assembleChunks, getChunks } from "../src/chunks";

const token = 'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbeyJpZCI6IjBOSTNUVUFzMVNmeSIsImFtb3VudCI6MSwic2VjcmV0IjoicXc5K2xTQk43cEVzZEJzRlR3WFhVR01pWndEdGVyTE5WZFk1dTFsQ2pHZz0iLCJDIjoiMDI4ZTg2NDhjMzY0Y2FlOGYzYzQyY2EwZTUzNTZlNWFkOWIzNTliMTk5Yzk5OTZlMzFiZGM1NTAyMTZhOGJkOTNkIn0seyJpZCI6IjBOSTNUVUFzMVNmeSIsImFtb3VudCI6NCwic2VjcmV0IjoicnB2TUdKc25DUHh6ZWVMdUtJQ3owUGg1WW5SejVzRHJ6TXh2YnVaR2Z3az0iLCJDIjoiMDI5Y2Q3YTFmNThmMmQwMzU3OTBkZGMxNzdlZGFiMzczMzczMmIxNmIyYjRlZjU1MjQ0N2M5ZWRhZGM2NzI1M2IwIn1dLCJtaW50IjoiaHR0cHM6Ly9sZWdlbmQubG5iaXRzLmNvbS9jYXNodS9hcGkvdjEvNGdyOVhjbXozWEVrVU53aUJpUUdvQyJ9XX0'

describe('test chunk', () => {
	test('example', async () => {
        const chunks = getChunks(token)
        const reassembled = assembleChunks(chunks)

        console.log(reassembled)
	});
});
