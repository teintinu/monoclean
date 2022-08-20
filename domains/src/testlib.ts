import { createJobManager, JobCallbackArgs, JobManager, Job, Node } from './job'
import { asap, defer, sleep } from 'pjobs'
import { Bundler } from './bundler'
import { ByPackage, createWorkspace, Package, WalkedJobs } from './workspace'
import { createProgress } from './progress'
import { ProcessParams, RunningProcess, System, Unscribe } from './sys'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { Readable, Writable } from 'stream'
import { cpus } from 'os'

export const cwd = process.cwd()
const fakeProcess = './scripts/fake-process.js'
const shell = true

export type Logger=ReturnType<typeof createFakeLog>

export function createFakeLog (verbose?: 'verbose') {
  const logged: string[] = []
  const aOk = defer<void>()
  const bOk = defer<void>()
  const cOk = defer<void>()
  const handleOutput = jest.fn<void, JobCallbackArgs>()
    .mockImplementation(async (job, chunk, error) => {
      const lines = chunk.trim().split('\n')
      lines.forEach((s) => {
        if (s === 'a' || s === 'INPUT: a') setTimeout(aOk.resolve, 100)
        if (s === 'b' || s === 'INPUT: b') setTimeout(bOk.resolve, 100)
        if (s === 'c' || s === 'INPUT: c') setTimeout(cOk.resolve, 100)
        job.progress.update({
          state: 'working',
          message: (error ? ' (error): ' : '') + s
        })
      })
    })
  const fsListeners: Record<string, Set<Unscribe>> = {}
  const fakeSys: System & { simulateChange(path: string):void} = {
    concurrency: cpus().length,
    getRepository: fsGetRepository,
    simulateChange: fsChanged,
    loadWorkspace,
    notify: fsNotify,
    createProcess: fsCreateProcess,
    watch: fsWatch
  }
  const jobManager = createJobManager(fakeSys)
  const fakeLogger = {
    jobManager,
    handleOutput,
    aOk,
    bOk,
    cOk,
    fakeSys,
    verbose,
    log (...args: string[]) {
      logged.push(args.join(' '))
      if (verbose) { console.info(args.join(' ')) }
    },
    logged,
    tree () {
      const done: {[id: number]:boolean} = {}
      const tree = jobManager.getTree()
      const lines:string[] = []
      treeOfNode(tree, '')
      return lines.join('\n')
      function treeOfNode (nodes: Node[], ident:string) {
        nodes.forEach((node) => {
          const id = node.job.id
          if (done[id]) {
            lines.push(node.job.title + '(rec)')
          }
          done[id] = true
          lines.push(ident + node.job.title)
          lines.push(ident + '  dependents:')
          node.dependents.forEach((dependent) => {
            lines.push(ident + '    ' + dependent.job.title)
          })
          lines.push(ident + '  dependencies:')
          treeOfNode(node.dependencies, ident + '    ')
          done[id] = false
        })
      }
    }
  }
  return fakeLogger
  function fsChanged (path: string): void {
    const list = fsListeners[path]
    if (list) list.forEach(fn => asap(fn))
  }
  function fsWatch (paths: string[], callback: ()=>void): Unscribe {
    const removers:Unscribe[] = []
    paths.forEach(path => {
      let list = fsListeners[path]
      if (list) list = fsListeners[path] = new Set<Unscribe>()
      list.add(callback)
      removers.push(() => list.delete(callback))
    })
    return () => {
      removers.forEach((r) => r())
    }
  }
  function fsGetRepository (folder: string): string|undefined {
    return 'repo:' + folder
  }
  function loadWorkspace (folder:string) {
    const [sBundler, sPkg, sDeps, sLayer, sInvalid] = folder.split('/')
    let bundler:Bundler
    if (sBundler === 'npm') bundler = createFakeBundlerNPM(fakeLogger)
    else throw new Error('fake-fs-invalid-bundle')
    return createFakeWorkspace({
      logger: fakeLogger,
      bundler,
      packages: sPkg as FakePackages,
      deps: sDeps === 'deps',
      layers: sLayer === 'layers',
      invalid: sInvalid === 'invalid'
    })
  }
  function fsNotify (msg: string, pkgName: string) {
    fakeLogger.log('fsNotify:' + msg + ' on package: ' + pkgName)
  }
  function fsCreateProcess ({ title, cmd, args, handleOutput }: ProcessParams): RunningProcess {
    let childProcess: ChildProcessWithoutNullStreams|undefined
    let sendStream : Writable|undefined
    let receiveStream: Readable|undefined
    let exitCode = 0
    const promise = new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        shell
      })
      child.stdout.on('data', (chunk) => {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        handleOutput(data, false)
      })
      child.stderr.on('data', function (chunk) {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        handleOutput(data, false)
      })
      sendStream = child.stdin

      childProcess = child
      child.on('error', function (err) {
        reject(err)
      })
      child.on('close', async (code) => {
        await sleep(100)
        exitCode = code || 0
        asap(p.kill)
        if (exitCode) {
          const err = new Error('error level=' + exitCode)
          handleOutput(err.message, true).finally(() => {
            reject(err)
          })
        } else {
          resolve()
        }
      })
    })
    const p:RunningProcess = {
      promise,
      kill () {
        if (childProcess) {
          fakeLogger.log('killing ' + title)
          try {
            childProcess.kill('SIGKILL')
          } catch (e) {
          //
          }
        }
        childProcess = undefined
        sendStream = undefined
        if (receiveStream) {
          receiveStream.destroy()
          receiveStream = undefined
        }
      },
      type (text) {
        if (sendStream) {
          sendStream.write(text)
        }
      }
    }
    return p
  }
}

export function createFakeProgress (logger: Logger, title: string, manual: boolean) {
  const pg = createProgress(manual)
  pg.on((status) => {
    logger.log(title + ' ' + status.state + ' ' + status.message)
  })
  return pg
}

export function createFakeJob (logger: Logger, delay: number, title: string, args: string[], manual: boolean = false) {
  logger.log('creating job [' + title + ']')
  const job = logger.jobManager.createJob({
    title,
    cwd,
    cmd: 'node',
    args: [fakeProcess, String(delay), ...args],
    shell,
    queue: 'sequential',
    manual
  })
  job.progress.on((status) => {
    logger.log('pg ' + title + ': ' + status.state + ' ' + status.message)
  })
  job.listen(logger.handleOutput)
  return job
}

export function create2FakeJob (logger: Logger, delay: number, mainTitle: string, mainArgs: string[], depTitle: string, depArgs: string[]) {
  logger.log('creating main job [' + mainTitle + ']')
  const main = logger.jobManager.createJob({
    title: mainTitle,
    cwd,
    cmd: 'node',
    args: [fakeProcess, String(delay), ...mainArgs],
    shell,
    queue: 'persistent',
    manual: false
  })
  logger.log('creating dep job [' + depTitle + ']')
  const dep = logger.jobManager.createJob({
    title: depTitle,
    cwd,
    cmd: 'node',
    args: [fakeProcess, String(delay), ...depArgs],
    shell,
    queue: 'persistent',
    manual: false
  })
  main.depends(dep)
  main.progress.on((status) => {
    logger.log('pg-main ' + status.state + ' ' + status.message)
  })
  dep.progress.on((status) => {
    logger.log('pg-dep ' + status.state + ' ' + status.message)
  })
  main.listen(logger.handleOutput)
  dep.listen(logger.handleOutput)
  return {
    main, dep
  }
}

function createFakeBundlerNPM (logger:Logger) {
  const fakeBundler: Bundler = {
    name: 'fakeBundlerNPM',
    getPathsToWatch (pkg) {
      return ['fakeBundlerNPM/' + pkg.name]
    },
    build (pkg, jobManager, goal) {
      return createFakeBundlerCommand(pkg, jobManager, 'npm-build-' + goal)
    },
    test (pkg, jobManager) {
      return createFakeBundlerCommand(pkg, jobManager, 'npm-test')
    },
    publish (pkg, jobManager, goal) {
      return createFakeBundlerCommand(pkg, jobManager, 'npm-publish-' + goal)
    },
    lint (pkg, jobManager) {
      return createFakeBundlerCommand(pkg, jobManager, 'npm-lint')
    },
    measure (pkg, jobManager) {
      return createFakeBundlerCommand(pkg, jobManager, 'npm-measure')
    }
  }
  return fakeBundler
  function createFakeBundlerCommand (pkg: Package, cmdJobManager: JobManager, cmd: string) {
    expect(cmdJobManager).toBe(logger.jobManager)
    return createFakeJob(
      logger,
      100,
      pkg.name + '(' + cmd + ')',
      [
        cmd
      ]
    )
  }
}

type FakePackages='x'|'xy'|'abcde'

function createFakeWorkspace (
  { logger, bundler, packages, deps, layers, invalid }:
  { logger: Logger, bundler: Bundler, packages:FakePackages, deps: boolean; layers: boolean; invalid: boolean }) {
  const pkgs:{
      [n:string]:Package
    } = {}
  for (const n of packages) {
    const pkg: Readonly<Package> = {
      name: n,
      layer: layers ? n : '',
      dependencies: [],
      bundlers: [bundler.name]
    }
    pkgs[n] = pkg
  }
  if (deps) {
    if (packages === 'xy') {
      pkgs.x = {
        ...pkgs.x,
        dependencies: invalid ? ['z'] : ['y']
      }
    }
    if (packages === 'abcde') {
      pkgs.a = {
        ...pkgs.a,
        dependencies: invalid ? ['b', 'c', 'z'] : ['b', 'c']
      }
      pkgs.b = {
        ...pkgs.b,
        dependencies: ['c', 'd']
      }
      pkgs.c = {
        ...pkgs.c,
        dependencies: ['d']
      }
      pkgs.d = {
        ...pkgs.d,
        dependencies: ['e']
      }
    }
  }
  const ws = createWorkspace({
    sys: logger.fakeSys,
    layers: [],
    packages: Object.keys(pkgs).map((n) => pkgs[n]),
    bundlers: [bundler]
  })
  return ws
}

export function jobDebug (job: Job) {
  return job.title + '(' +
    [...job.dependencies]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(dep => dep.title) +
    ')'
}

export function walkedDebug (walkJobs: WalkedJobs) {
  const ret: ByPackage<unknown> = {}
  const pkgs = Object.keys(walkJobs.jobs).sort()
  pkgs.forEach((pkg) => {
    ret[pkg] = ([...walkJobs.jobs[pkg]] || [])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(jobDebug)
  })
  return ret
}
