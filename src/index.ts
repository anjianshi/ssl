import { runTask } from './task.js'

const inputWorkDirectory = process.argv[2]
await runTask(inputWorkDirectory)
