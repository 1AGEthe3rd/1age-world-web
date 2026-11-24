const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const browserArgs = [
  '--no-sandbox', '--enable-webgl', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
]
const desktop = { width: 1280, height: 720 }
const portrait = { width: 390, height: 844 }
const landscape = { width: 844, height: 390 }
const entries = [
  ['baseline-world', '/', desktop],
  ['baseline-page', '/?entry=page', desktop, 'Page'],
  ['baseline-space', '/?entry=space', desktop, 'Space'],
  ['baseline-games', '/?entry=games', desktop, 'Games'],
  ['preview-world', '/preview/', desktop],
  ['preview-page', '/preview/?platform=page', portrait, 'Page'],
  ['preview-space', '/preview/?platform=space', landscape, 'Space'],
  ['preview-games', '/preview/?platform=games', desktop, 'Games'],
  ['preview-quest', '/preview/?platform=quest', desktop, 'Quest'],
  ['preview-design', '/preview/?platform=design', desktop, 'Design'],
  ['preview-blog', '/preview/?platform=blog', portrait, 'Blog']
]

async function render(browser, origin, [name, path, viewport, platform]) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport !== desktop,
    hasTouch: viewport !== desktop
  })
  const page = await context.newPage()
  const messages = []
  const errors = []
  page.on('console', message => messages.push(message.text()))
  page.on('pageerror', error => errors.push(error.message))

  try {
    const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
    if (!response?.ok()) throw new Error('World loader request failed')
    await page.waitForFunction(() => {
      const canvas = document.getElementById('canvas')
      return !document.getElementById('status') && canvas?.width > 0 && canvas?.height > 0 &&
        Boolean(canvas.getContext('webgl2'))
    }, null, { timeout: 35000 })
    if (platform && !messages.some(message => message.includes('1AGE WORLD PLATFORM ENTRY: ' + platform))) {
      throw new Error('Expected arrival at ' + platform)
    }
    if (errors.length) throw new Error(errors.join('\n'))
    await page.screenshot({ path: 'captures/' + name + '.png' })
    console.log(name, 'passed', platform ?? 'World')
  } catch (error) {
    await page.screenshot({ path: 'captures/' + name + '-failure.png' }).catch(() => {})
    const notice = await page.locator('#status-notice').textContent({ timeout: 1000 }).catch(() => '')
    throw new Error(name + ': ' + error.message + '\n' + notice + '\n' + messages.slice(-12).join('\n'))
  } finally {
    await context.close()
  }
}

async function liveEntrance(browser, platform) {
  const domain = 'https://1age.' + platform.toLowerCase() + '/'
  const context = await browser.newContext({ viewport: desktop })
  try {
    const page = await context.newPage()
    const entry = page.waitForEvent('console', {
      predicate: message => message.text().includes('1AGE WORLD PLATFORM ENTRY: ' + platform),
      timeout: 45000
    })
    await Promise.all([page.goto(domain, { waitUntil: 'domcontentloaded' }), entry])
    const frame = page.frames().find(frame => new URL(frame.url()).searchParams.get('entry') === platform.toLowerCase())
    if (!frame || page.url() !== domain) throw new Error('The app did not keep its direct domain and World entry')
    await frame.waitForFunction(() => !document.getElementById('status') && Boolean(document.querySelector('#canvas')?.getContext('webgl2')))
    await page.screenshot({ path: 'captures/live-' + platform.toLowerCase() + '.png' })
    console.log('live', platform, 'passed', domain)
  } finally {
    await context.close()
  }
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' })
  const origin = 'http://127.0.0.1:8765'
  let browser
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await fetch(origin).then(response => response.ok).catch(() => false)) break
      if (attempt === 39) throw new Error('Preview server did not start')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true,
      args: browserArgs
    })
    let failures = 0
    for (const entry of entries) {
      try {
        await render(browser, origin, entry)
      } catch (error) {
        failures++
        console.error(error.message)
      }
    }
    for (const platform of ['Page', 'Space', 'Games']) {
      try {
        await liveEntrance(browser, platform)
      } catch (error) {
        failures++
        console.error('live', platform, error.message)
      }
    }
    await Promise.all(['quest', 'exchange', 'cash'].map(async app => {
      try {
        const response = await fetch('https://1age.' + app + '/', { signal: AbortSignal.timeout(8000) })
        console.log('hosting', app, response.status)
      } catch (error) {
        console.log('hosting', app, error.cause?.code || error.message)
      }
    }))
    if (failures) process.exitCode = 1
  } finally {
    await browser?.close()
    server.kill()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
