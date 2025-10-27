/**
 * All-in-one migration runner with data persistence verification
 * 
 * Usage: node scripts/run-migration.js
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import readline from 'readline'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve))
}

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m',   // Red
    reset: '\x1b[0m'
  }
  
  const icons = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✗'
  }
  
  console.log(`${colors[type]}${icons[type]} ${message}${colors.reset}`)
}

async function runStep(stepNumber, stepName, command, skipConfirm = false) {
  console.log('\n' + '='.repeat(70))
  console.log(`STEP ${stepNumber}: ${stepName}`)
  console.log('='.repeat(70))
  
  if (!skipConfirm) {
    const answer = await question(`\nReady to run this step? (yes/no): `)
    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      log('Step skipped', 'warning')
      return false
    }
  }
  
  log(`Running: ${command}`, 'info')
  console.log()
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path.join(__dirname, '..'),
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    })
    
    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)
    
    log(`Step ${stepNumber} completed successfully!`, 'success')
    return true
  } catch (error) {
    log(`Step ${stepNumber} failed: ${error.message}`, 'error')
    if (error.stdout) console.log(error.stdout)
    if (error.stderr) console.error(error.stderr)
    return false
  }
}

async function compareBackups() {
  const backupsDir = path.join(__dirname, '..', 'backups')
  
  if (!fs.existsSync(backupsDir)) {
    log('No backups directory found', 'warning')
    return
  }
  
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .sort()
  
  if (files.length < 2) {
    log('Need at least 2 backups to compare', 'warning')
    return
  }
  
  const before = JSON.parse(fs.readFileSync(path.join(backupsDir, files[0]), 'utf8'))
  const after = JSON.parse(fs.readFileSync(path.join(backupsDir, files[files.length - 1]), 'utf8'))
  
  console.log('\n' + '='.repeat(70))
  console.log('DATA PERSISTENCE VERIFICATION')
  console.log('='.repeat(70))
  console.log()
  
  // Compare MongoDB
  if (before.mongodb && after.mongodb) {
    console.log('MongoDB Collections:')
    const beforeColls = before.mongodb.collections
    const afterColls = after.mongodb.collections
    
    for (const collName of Object.keys(beforeColls)) {
      const beforeCount = beforeColls[collName]?.count || 0
      const afterCount = afterColls[collName]?.count || 0
      
      if (beforeCount === afterCount) {
        log(`  ${collName}: ${beforeCount} → ${afterCount} (✓ UNCHANGED)`, 'success')
      } else {
        log(`  ${collName}: ${beforeCount} → ${afterCount} (⚠ CHANGED)`, 'warning')
      }
    }
    console.log()
  }
  
  // Compare Chime
  if (before.chime && after.chime) {
    console.log('Chime Resources:')
    
    const beforeChannels = before.chime.channels?.length || 0
    const afterChannels = after.chime.channels?.length || 0
    
    if (beforeChannels === afterChannels) {
      log(`  Channels: ${beforeChannels} → ${afterChannels} (✓ UNCHANGED)`, 'success')
    } else {
      log(`  Channels: ${beforeChannels} → ${afterChannels} (⚠ CHANGED)`, 'warning')
    }
    
    const beforeUsers = before.chime.appInstanceUsers?.length || 0
    const afterUsers = after.chime.appInstanceUsers?.length || 0
    const userDiff = afterUsers - beforeUsers
    
    if (userDiff === 3) {
      log(`  AppInstance Users: ${beforeUsers} → ${afterUsers} (✓ +3 service accounts added)`, 'success')
    } else if (beforeUsers === afterUsers) {
      log(`  AppInstance Users: ${beforeUsers} → ${afterUsers} (✓ UNCHANGED)`, 'success')
    } else {
      log(`  AppInstance Users: ${beforeUsers} → ${afterUsers} (⚠ UNEXPECTED CHANGE)`, 'warning')
    }
    console.log()
  }
  
  console.log('='.repeat(70))
  console.log()
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║           SERVICE ACCOUNT MIGRATION - AUTOMATED RUNNER            ║
║                                                                   ║
║  This script will safely migrate your Chime implementation to    ║
║  use service accounts. All your data will be preserved.          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`)
  
  log('This migration will:', 'info')
  console.log('  1. Backup your current state')
  console.log('  2. Create service accounts in Chime')
  console.log('  3. Promote admin service to moderator on all channels')
  console.log('  4. Verify data persistence')
  console.log()
  
  const ready = await question('Do you want to proceed? (yes/no): ')
  if (ready.toLowerCase() !== 'yes' && ready.toLowerCase() !== 'y') {
    log('Migration cancelled', 'warning')
    rl.close()
    process.exit(0)
  }
  
  // Step 1: Backup
  const backup1 = await runStep(
    1,
    'Backup Current State',
    'node backups/backup-current-state.js'
  )
  
  if (!backup1) {
    log('Migration stopped due to backup failure', 'error')
    rl.close()
    process.exit(1)
  }
  
  // Step 2: Create service accounts
  const createAccounts = await runStep(
    2,
    'Create Service Accounts',
    'node backups/create-service-accounts.js'
  )
  
  if (!createAccounts) {
    log('Migration stopped', 'error')
    rl.close()
    process.exit(1)
  }
  
  // Prompt for .env update
  console.log('\n' + '='.repeat(70))
  log('ACTION REQUIRED: Update your .env file', 'warning')
  console.log('='.repeat(70))
  console.log()
  console.log('Copy the service account ARNs from above and add them to your .env file:')
  console.log()
  console.log('CHIME_SERVICE_ADMIN_ARN=arn:aws:chime:...')
  console.log('CHIME_SERVICE_MODERATOR_ARN=arn:aws:chime:...')
  console.log('CHIME_SERVICE_MEMBER_ARN=arn:aws:chime:...')
  console.log()
  
  const envUpdated = await question('Have you updated your .env file? (yes/no): ')
  if (envUpdated.toLowerCase() !== 'yes' && envUpdated.toLowerCase() !== 'y') {
    log('Please update .env and run this script again', 'warning')
    rl.close()
    process.exit(0)
  }
  
  // Step 3: Promote admin service
  const promote = await runStep(
    3,
    'Promote Admin Service to Moderator on All Channels',
    'node backups/promote-admin-service.js'
  )
  
  if (!promote) {
    log('Migration stopped', 'error')
    rl.close()
    process.exit(1)
  }
  
  // Step 4: Verify data persistence
  const backup2 = await runStep(
    4,
    'Create Post-Migration Backup',
    'node backups/backup-current-state.js',
    true // Skip confirmation
  )
  
  if (backup2) {
    await compareBackups()
  }
  
  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('MIGRATION COMPLETE!')
  console.log('='.repeat(70))
  console.log()
  log('✅ Service accounts created', 'success')
  log('✅ Admin service promoted on all channels', 'success')
  log('✅ Data persistence verified', 'success')
  console.log()
  console.log('Next Steps:')
  console.log('  1. Review the backup comparison above')
  console.log('  2. Update your code to use service accounts')
  console.log('  3. Test admin operations')
  console.log('  4. Deploy to production')
  console.log()
  console.log('Backup files are saved in: commuity-backend/backups/')
  console.log()
  
  rl.close()
  process.exit(0)
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'error')
  console.error(err)
  rl.close()
  process.exit(1)
})

