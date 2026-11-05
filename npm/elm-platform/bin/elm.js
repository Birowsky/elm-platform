#!/usr/bin/env node
// What every tool reaches as `elm`. It readies the Elm home and the project, then hands over to the real compiler.

import { spawn } from 'node:child_process'
import { prepareHome } from '../lib/home.js'
import { elmHome, toBinary } from '../lib/platform.js'
import { findProject, prepareProject } from '../lib/project.js'

prepareHome()
const project = findProject(process.cwd())
if (project) prepareProject(project)
const elm = spawn(toBinary(), process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, ELM_HOME: elmHome() } })
elm.on('exit', exitLikeElm)
elm.on('error', failToStart)
forwardSignal('SIGINT')
forwardSignal('SIGTERM')

function exitLikeElm(code, signal) {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
}

function failToStart(error) {
  console.error(`Could not start the Elm compiler: ${error.message}`)
  process.exit(1)
}

function forwardSignal(signal) {
  process.on(signal, () => elm.kill(signal))
}
