module.exports = {
  publicPath: './',
  pages: {
    index: 'src/main.js'
  },
  configureWebpack: {
    externals: {
      electron: 'commonjs2 electron'
    }
  },
  chainWebpack: config => {
    config.module.rule('fonts').set('generator', {
      filename: '[name].[hash:8][ext]'
    })
  },
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,
      extraResources: [
        {
          from: 'src/main/myvideo/runtime.worker.js',
          to: 'myvideo/runtime.worker.js'
        }
      ],
      builderOptions: {
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true
        },
        appId: 'com.a942199.myzyplayer',
        copyright: 'MY-ZYPlayer contributors',
        productName: 'MY-ZYPlayer',
        publish: [
          {
            provider: 'github',
            owner: 'A942199',
            repo: 'MY-ZYPlayer'
          }
        ],
        mac: {
          icon: 'build/icon/icon.icns',
          category: 'public.app-category.developer-tools',
          target: 'default',
          extendInfo: {
            LSUIElement: 1
          }
        },
        win: {
          icon: 'build/icons/icon.ico',
          target: 'nsis'
        },
        linux: {
          icon: 'build/icons/'
        },
        snap: {
          publish: ['github']
        }
      }
    }
  }
}
