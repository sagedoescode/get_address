const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f5'
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// MAC Collection Functions
function getMachineInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform() === 'darwin' ? 'Darwin' : os.platform(),
    platform_release: os.release(),
    platform_version: os.version(),
    architecture: os.arch(),
    processor: os.cpus()[0].model,
    username: os.userInfo().username || process.env.USER || 'unknown'
  };
}

function getMacAddressesUnix() {
  const addresses = [];
  try {
    const output = execSync('ifconfig').toString('utf-8');

    const interfaces = output.match(/^([a-zA-Z0-9]+):/gm)?.map(i => i.replace(':', '')) || [];

    const macRegex = /ether\s+([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/gi;

    let match;
    let index = 0;
    while ((match = macRegex.exec(output)) !== null) {
      const interface = interfaces[index] || "Unknown";
      addresses.push({
        interface: interface,
        mac_address: match[1].toLowerCase()
      });
      index++;
    }

    if (addresses.length === 0) {
      const macAddressRegex = /([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/gi;
      let macIndex = 0;
      while ((match = macAddressRegex.exec(output)) !== null) {
        const interface = interfaces[macIndex] || "Unknown";
        addresses.push({
          interface: interface,
          mac_address: match[1].toLowerCase()
        });
        macIndex++;
      }
    }
  } catch (err) {
    console.error(`Error getting Unix MAC addresses: ${err.message}`);
  }

  return addresses;
}

function getUniqueSystemId() {
  try {
    let systemUuid = BigInt(parseInt(os.networkInterfaces().en0?.[0]?.mac?.replace(/:/g, ''), 16) || Date.now()).toString();

    try {
      const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep -i "IOPlatformUUID"').toString('utf-8');
      const match = output.match(/"IOPlatformUUID"\s+=\s+"([^"]+)"/);
      if (match && match[1]) {
        systemUuid = match[1];
      }
    } catch (err) {
      console.error(`Warning: Could not get macOS system UUID: ${err.message}`);
    }

    return systemUuid;
  } catch (err) {
    console.error(`Error getting system ID: ${err.message}`);
    return Date.now().toString();
  }
}

ipcMain.on('collect-mac-info', async (event) => {
  try {
    // Get system info
    const systemInfo = getMachineInfo();

    // Get MAC addresses
    const macAddresses = getMacAddressesUnix();

    // Get unique system ID
    const systemId = getUniqueSystemId();

    // Send data back to renderer
    event.reply('mac-info-results', {
      success: true,
      systemInfo,
      systemId,
      macAddresses
    });
  } catch (err) {
    event.reply('mac-info-results', {
      success: false,
      error: err.message
    });
  }
});

ipcMain.on('save-mac-info', async (event, data) => {
  try {
    // Prepare output data
    const timestamp = new Date().toISOString();
    const outputData = {
      timestamp,
      system_info: data.systemInfo,
      system_id: data.systemId,
      mac_addresses: data.macAddresses
    };

    // Create output file
    const now = new Date();
    const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `system_id_${data.systemInfo.hostname}_${formattedDate}.txt`;

    // Allow user to choose save location
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save System ID File',
      defaultPath: path.join(app.getPath('desktop'), filename),
      filters: [
        { name: 'Text Files', extensions: ['txt'] }
      ]
    });

    if (!filePath) {
      event.reply('save-mac-info-result', {
        success: false,
        error: 'Save operation cancelled'
      });
      return;
    }

    let content = `System Authorization Information\n`;
    content += `===============================\n\n`;
    content += `Generated: ${timestamp}\n`;
    content += `Hostname: ${data.systemInfo.hostname}\n`;
    content += `Platform: ${data.systemInfo.platform} ${data.systemInfo.platform_release} ${data.systemInfo.platform_version}\n`;
    content += `Architecture: ${data.systemInfo.architecture}\n`;
    content += `Username: ${data.systemInfo.username}\n\n`;

    content += `System ID: ${data.systemId}\n\n`;

    content += `MAC Addresses:\n`;
    data.macAddresses.forEach((addr, i) => {
      content += `  ${i + 1}. ${addr.interface}: ${addr.mac_address}\n`;
    });

    // Also write the full JSON data for machine processing
    content += `\n\n--- Machine Readable Data Below ---\n\n`;
    content += JSON.stringify(outputData, null, 2);

    fs.writeFileSync(filePath, content);

    event.reply('save-mac-info-result', {
      success: true,
      filePath
    });
  } catch (err) {
    event.reply('save-mac-info-result', {
      success: false,
      error: err.message
    });
  }
});