import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as process from "process"

const absolutePath = (input: string) => {
  const pathWithHome = input.replace(/^[~]/, os.homedir())
  return path.resolve(pathWithHome)
}

const runDiff = async (
  aospRoot: string,
  rockchipRoot: string,
  force: boolean,
) => {
  let missing = false
  try {
    await fs.stat("./diff")
  } catch (e) {
    missing = true
  }
  if (force || missing) {
    const repoStatus = child_process.execSync(`repo status`)
    if (
      repoStatus.toString().trim() !=
      "project neuroflag/                              branch initial"
    ) {
      throw `Diff failed: repo is dirty`
    }
    try {
      const cmd = `diff --recursive --no-dereference --brief --exclude .git ${aospRoot} ${rockchipRoot} | tee ./diff`
      console.log(`Exec: ${cmd}`)
      child_process.execSync(cmd, { stdio: "inherit" })
    } catch (e) {
      // Ignore diff result
    }
  }
}
const parseDiff = async (aospPath: string, rockchipPath: string) => {
  const diffFile = await fs.open("./diff")
  const onlyAosp: string[] = []
  const onlyRockchip: string[] = []
  const modified: string[] = []
  for await (const line of diffFile.readLines()) {
    const onlyMatch = line.match(/^Only in ([\w-+,.@/]+): ([\w-+,.@]+)$/)
    const modifiedMatch = line.match(
      /^Files ([\w-+,.@/]{1,}) and ([\w-+,.@/]{1,}) differ$/,
    )
    if (onlyMatch) {
      const onlyFile = `${onlyMatch[1]}/${onlyMatch[2]}`
      if (onlyFile.startsWith(aospPath)) {
        const filePath = onlyFile.slice(aospPath.length + 1)
        onlyAosp.push(filePath)
      } else if (onlyFile.startsWith(rockchipPath)) {
        const filePath = onlyFile.slice(rockchipPath.length + 1)
        if (
          filePath.startsWith("bootable/recovery/.gitignore") ||
          filePath.startsWith("external/camera_engine_rkaiq/") ||
          filePath.startsWith("kernel/.gitignore") ||
          filePath.startsWith("neuroflag/")
        ) {
          // Hack: ignore difference
          continue
        }
        onlyRockchip.push(filePath)
      } else {
        throw `Only file ${onlyFile} is not in the target folders`
      }
    } else if (modifiedMatch) {
      if (!modifiedMatch[1].startsWith(aospPath)) {
        throw `File ${modifiedMatch[1]} is not in aosp`
      }
      if (!modifiedMatch[2].startsWith(rockchipPath)) {
        throw `File ${modifiedMatch[2]} is not in rockchip`
      }
      const filePath = modifiedMatch[1].slice(aospPath.length + 1)
      if (
        filePath.startsWith("bootable/recovery/.gitignore") ||
        filePath.startsWith("external/camera_engine_rkaiq/") ||
        filePath.startsWith("kernel/.gitignore") ||
        filePath.startsWith("neuroflag/")
      ) {
        // Hack: ignore difference
        continue
      }
      modified.push(filePath)
    } else {
      throw `Unknown line: ${line}`
    }
  }
  return { onlyAosp, onlyRockchip, modified }
}

const rsyncFiles = async (
  srcRoot: string,
  dstRoot: string,
  filePaths: string[],
) => {
  filePaths.forEach((filePath) => {
    console.log(`Rsync: ${filePath}`)
    const srcFile = `${srcRoot}/${filePath}`
    const dstFolder = path.dirname(`${dstRoot}/${filePath}`)
    const cmd = `rsync --archive --mkpath ${srcFile} ${dstFolder}/`
    console.log(`Exec: ${cmd}`)
    child_process.execSync(cmd, { stdio: "inherit" })
  })
}

const main = async () => {
  const aospRoot = absolutePath(process.argv[2] || "~/aosp")
  const rockchipRoot = absolutePath(process.argv[3] || "~/rk356x-android11")
  const git = true
  console.log("aosp: ", aospRoot)
  console.log("rockchip: ", rockchipRoot)
  await runDiff(aospRoot, rockchipRoot, false)
  const { onlyRockchip, modified } = await parseDiff(aospRoot, rockchipRoot)
  console.log("Only in rockchip:", onlyRockchip)
  console.log("Modified in rockchip:", modified)
  if (git) {
    child_process.execSync(`git checkout -b aosp/base initial`, {
      stdio: "inherit",
      cwd: `${aospRoot}/neuroflag`,
    })
    await rsyncFiles(aospRoot, `${aospRoot}/neuroflag`, modified)
    await rsyncFiles(aospRoot, `${aospRoot}/neuroflag`, [
      // Hack: extra aosp base
      "build/soong/ui/build/finder.go",
    ])
    child_process.execSync(`git add --all && git commit -m "aosp: base"`, {
      stdio: "inherit",
      cwd: `${aospRoot}/neuroflag`,
    })
    child_process.execSync(`git checkout -b rockchip/base aosp/base`, {
      stdio: "inherit",
      cwd: `${aospRoot}/neuroflag`,
    })
  }
  await rsyncFiles(rockchipRoot, `${aospRoot}/neuroflag`, modified)
  await rsyncFiles(rockchipRoot, `${aospRoot}/neuroflag`, onlyRockchip)
  if (git) {
    child_process.execSync(`git add --all && git commit -m "rockchip: base"`, {
      stdio: "inherit",
      cwd: `${aospRoot}/neuroflag`,
    })
  }
}

main()
