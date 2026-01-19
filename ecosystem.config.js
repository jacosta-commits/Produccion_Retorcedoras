// C:\Users\Administrador\Desktop\ZENTRIK_operario\Retorcedoras_Prod\ecosystem.config.js
module.exports = {
  apps: [{
    name: 'retorcedoras',
    script: 'backend/src/server.js',
    cwd: 'C:/Users/Administrador/Desktop/ZENTRIK_operario/Retorcedoras_Prod',
    env: {
      NODE_ENV: 'production',
      BASE_PATH: '/'              // o '/retorcidos/' si así lo necesitas
    },
    time: true,
    watch: false
  }]
}
