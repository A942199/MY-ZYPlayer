import { sites, setting } from '../dexie'
import axios from 'axios'
import cheerio from 'cheerio'

const remote = require('@electron/remote')
const win = remote.getCurrentWindow()
const session = win.webContents.session
const cms = require('./cms')
const myvideo = require('./myvideo')

// 取消axios请求  浅析cancelToken https://juejin.cn/post/6844904168277147661 https://masteringjs.io/tutorials/axios/cancel
// const source = axios.CancelToken.source()
// const cancelToken = source.token

// 请求超时时限
// axios.defaults.timeout = 10000 // 可能使用代理，增长超时
const TIMEOUT = 20000

// 重试次数，共请求2次
axios.defaults.retry = 1

// 请求的间隙
axios.defaults.retryDelay = 1000

// 使用请求拦截器动态调整超时
axios.interceptors.request.use(function (config) {
  if (config.__retryCount === undefined) {
    config.timeout = TIMEOUT
  } else {
    config.timeout = TIMEOUT * (config.__retryCount + 1)
  }
  return config
}, function (err) {
  return Promise.reject(err)
})

// 添加响应拦截器
axios.interceptors.response.use(function (response) {
  return response
}, function (err) { // 请求错误时做些事
  // 请求超时的之后，抛出 err.code = ECONNABORTED的错误..错误信息是 timeout of  xxx ms exceeded
  if (err.code === 'ECONNABORTED' && err.message.indexOf('timeout') !== -1) {
    const config = err.config
    config.__retryCount = config.__retryCount || 0

    if (config.__retryCount >= config.retry) {
      err.message = '多次请求均超时'
      return Promise.reject(err)
    }

    config.__retryCount += 1

    const backoff = new Promise(function (resolve) {
      setTimeout(function () {
        resolve()
      }, config.retryDelay || 1)
    })

    return backoff.then(function () {
      return axios(config)
    })
  } else {
    if (err && !err.response) {
      err.message = '连接服务器失败!'
    }
    return Promise.reject(err)
  }
})

const zy = {
  xmlConfig: { // XML 转 JSON 配置
    trimValues: true,
    textNodeName: '_t',
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    parseAttributeValue: true
  },
  getSite (key) {
    return new Promise((resolve, reject) => {
      sites.all().then(res => {
        for (const i of res) {
          if (key === i.key) {
            resolve(i)
          }
        }
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
   * 获取资源分类 和 所有资源的总数, 分页等信息
   * @param {*} key 资源网 key
   * @returns
   */
  class (key) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        if (myvideo.isSource(res)) {
          myvideo.classes(res).then(resolve).catch(reject)
          return
        }
        const url = res.api
        axios.get(url).then(res => {
          const data = res.data
          const jsondata = cms.parse(data)
          if (!jsondata?.class || !jsondata?.list) resolve()
          const arr = []
          if (jsondata.class) {
            // 有些网站返回的分类名里会含有一串包含在{}内的字符串,移除掉
            const regex = /\{.*\}/i
            for (const i of jsondata.class.ty) {
              const j = {
                tid: i._id,
                name: i._t.replace(regex, '')
              }
              arr.push(j)
            }
          }
          const doc = {
            class: arr,
            page: jsondata.list._page,
            pagecount: jsondata.list._pagecount,
            pagesize: jsondata.list._pagesize,
            recordcount: jsondata.list._recordcount
          }
          resolve(doc)
        }).catch(err => {
          reject(err)
        })
      })
    })
  },
  /**
   * 获取资源列表
   * @param {*} key 资源网 key
   * @param {number} [pg=1] 翻页 page
   * @param {*} t 分类 type
   * @returns
   */
  list (key, pg = 1, t) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        const site = res
        if (myvideo.isSource(site)) {
          myvideo.list(site, pg, t).then(resolve).catch(reject)
          return
        }
        let url = null
        if (t) {
          url = `${site.api}?ac=videolist&t=${t}&pg=${pg}`
        } else {
          url = `${site.api}?ac=videolist&pg=${pg}`
        }
        axios.get(url).then(async res => {
          const data = res.data
          const jsondata = cms.parse(data)
          const videoList = cms.asArray(jsondata.list.video)
          if (videoList && videoList.length) {
            resolve(videoList)
          } else {
            resolve([])
          }
        }).catch(err => {
          reject(err)
        })
      })
    })
  },
  /**
   * 获取总资源数, 以及页数
   * @param {*} key 资源网
   * @param {*} t 分类 type
   * @returns page object
   */
  page (key, t) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        const site = res
        if (myvideo.isSource(site)) {
          myvideo.page(site, t).then(resolve).catch(reject)
          return
        }
        let url = ''
        if (t) {
          url = `${site.api}?ac=videolist&t=${t}`
        } else {
          url = `${site.api}?ac=videolist`
        }
        axios.get(url).then(async res => {
          const jsondata = cms.parse(res.data)
          const pg = {
            page: jsondata.list._page,
            pagecount: jsondata.list._pagecount,
            pagesize: jsondata.list._pagesize,
            recordcount: jsondata.list._recordcount
          }
          resolve(pg)
        }).catch(err => {
          reject(err)
        })
      })
    })
  },
  /**
   * 搜索资源
   * @param {*} key 资源网 key
   * @param {*} wd 搜索关键字
   * @returns
   */
  search (key, wd) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        const site = res
        if (myvideo.isSource(site)) {
          myvideo.search(site, wd).then(resolve).catch(reject)
          return
        }
        const url = `${site.api}?wd=${encodeURI(wd)}`
        axios.get(url, { timeout: 3000 }).then(res => {
          const data = res.data
          const jsondata = cms.parse(data)
          if (jsondata && jsondata.list) {
            let videoList = jsondata.list.video
            if (Object.prototype.toString.call(videoList) === '[object Object]') videoList = [].concat(videoList)
            videoList = videoList?.filter(e => e.name.toLowerCase().includes(wd.toLowerCase()))
            if (videoList?.length) {
              resolve(videoList)
            } else {
              resolve()
            }
          } else {
            resolve()
          }
        }).catch(err => {
          reject(err)
        })
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
   * 搜索资源详情
   * @param {*} key 资源网 key
   * @param {*} wd 搜索关键字
   * @returns
   */
  searchFirstDetail (key, wd) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        const site = res
        if (myvideo.isSource(site)) {
          myvideo.search(site, wd).then(videoList => {
            if (videoList?.length) {
              myvideo.detail(site, videoList[0].id).then(resolve).catch(reject)
            } else {
              resolve()
            }
          }).catch(reject)
          return
        }
        const url = `${site.api}?wd=${encodeURI(wd)}`
        axios.get(url, { timeout: 3000 }).then(res => {
          const data = res.data
          const jsondata = cms.parse(data)
          if (jsondata && jsondata.list) {
            let videoList = jsondata.list.video
            if (Object.prototype.toString.call(videoList) === '[object Object]') videoList = [].concat(videoList)
            videoList = videoList?.filter(e => e.name.toLowerCase().includes(wd.toLowerCase()))
            if (videoList?.length) {
              this.detail(key, videoList[0].id).then(detailRes => {
                resolve(detailRes)
              })
            } else {
              resolve()
            }
          } else {
            resolve()
          }
        }).catch(err => {
          reject(err)
        })
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
   * 获取资源详情
   * @param {*} key 资源网 key
   * @param {*} id 资源唯一标识符 id
   * @returns
   */
  detail (key, id) {
    return new Promise((resolve, reject) => {
      this.getSite(key).then(res => {
        if (myvideo.isSource(res)) {
          myvideo.detail(res, id).then(resolve).catch(reject)
          return
        }
        const url = `${res.api}?ac=videolist&ids=${id}`
        axios.get(url).then(res => {
          const data = res.data
          const jsondata = cms.parse(data)
          const videoList = cms.asArray(jsondata?.list?.video)[0]
          if (!videoList) resolve()
          // Parse video lists
          let fullList = []
          let index = 0
          const supportedFormats = ['m3u8', 'mp4']
          const dd = videoList.dl.dd
          const type = Object.prototype.toString.call(dd)
          if (type === '[object Array]') {
            for (const i of dd) {
              i._t = i._t.replace(/\$+/g, '$')
              const ext = Array.from(new Set(...i._t.split('#').map(e => e.includes('$') ? e.split('$')[1].match(/\.\w+?$/) : e.match(/\.\w+?$/)))).map(e => e.slice(1))
              if (ext.length && ext.length <= supportedFormats.length && ext.every(e => supportedFormats.includes(e))) {
                if (ext.length === 1) {
                  i._flag = ext[0]
                } else {
                  i._flag = index ? 'ZY支持-' + index : 'ZY支持'
                  index++
                }
              }
              fullList.push(
                {
                  flag: i._flag,
                  list: i._t.split('#').filter(e => e && (e.startsWith('http') || (e.split('$')[1] && e.split('$')[1].startsWith('http'))))
                }
              )
            }
          } else {
            fullList.push(
              {
                flag: dd._flag,
                list: dd._t.replace(/\$+/g, '$').split('#').filter(e => e && (e.startsWith('http') || (e.split('$')[1] && e.split('$')[1].startsWith('http'))))
              }
            )
          }
          fullList.forEach(item => {
            if (item.list.every(e => e.includes('$') && /^\s*\d+\s*$/.test(e.split('$')[0]))) item.list.sort((a, b) => { return a.split('$')[0] - b.split('$')[0] })
          })
          if (fullList.length > 1) { // 将ZY支持的播放列表前置
            index = fullList.findIndex(e => supportedFormats.includes(e.flag) || e.flag.startsWith('ZY支持'))
            if (index !== -1) {
              const first = fullList.splice(index, 1)
              fullList = first.concat(fullList)
            }
          }
          videoList.fullList = fullList
          resolve(videoList)
        }).catch(err => {
          reject(err)
        })
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
   * 下载资源
   * @param {*} key 资源网 key
   * @param {*} id 资源唯一标识符 id
   * @returns
   */
  download (key, id, videoFlag) {
    return new Promise((resolve, reject) => {
      let info = ''
      let downloadUrls = ''
      this.getSite(key).then(res => {
        const site = res
          if (site.download) {
            const url = `${site.download}?ac=videolist&ids=${id}&ct=1`
            axios.get(url).then(res => {
              const data = res.data
              const jsondata = cms.parse(data)
              const videoList = cms.asArray(jsondata.list.video)[0]
            const dd = videoList.dl.dd
            const type = Object.prototype.toString.call(dd)
            if (type === '[object Array]') {
              for (const i of dd) {
                downloadUrls = i._t.replace(/\$+/g, '$').split('#').map(e => encodeURI(e.includes('$') ? e.split('$')[1] : e)).join('\n')
              }
            } else {
              downloadUrls = dd._t.replace(/\$+/g, '$').split('#').map(e => encodeURI(e.includes('$') ? e.split('$')[1] : e)).join('\n')
            }
            if (downloadUrls) {
              info = '调用下载接口获取到的链接已复制, 快去下载吧!'
              resolve({ downloadUrls: downloadUrls, info: info })
            } else {
              throw new Error()
            }
          }).catch((err) => {
            err.info = '无法获取到下载链接，请通过播放页面点击“调试”按钮获取'
            reject(err)
          })
        } else {
          zy.detail(key, id).then(res => {
            const dl = res.fullList.find(e => e.flag === videoFlag) || res.fullList[0]
            for (const i of dl.list) {
              const url = encodeURI(i.includes('$') ? i.split('$')[1] : i)
              downloadUrls += (url + '\n')
            }
            if (downloadUrls) {
              info = '视频源链接已复制, 快去下载吧!'
              resolve({ downloadUrls: downloadUrls, info: info })
            } else {
              throw new Error()
            }
          }).catch((err) => {
            err.info = '无法获取到下载链接，请通过播放页面点击“调试”按钮获取'
            reject(err)
          })
        }
      })
    })
  },
  /**
   * 检查资源
   * @param {*} key 资源网 key
   * @returns boolean
   */
  async check (key, id) {
    try {
      const cls = await this.class(key)
      if (cls) {
        return true
      } else {
        return false
      }
    } catch (e) {
      return false
    }
  },
  /**
   * 获取豆瓣页面链接
   * @param {*} name 视频名称
   * @param {*} year 视频年份
   * @returns 豆瓣页面链接，如果没有搜到该视频，返回搜索页面链接
   */
  doubanLink (name, year) {
    return new Promise((resolve, reject) => {
      // 豆瓣搜索链接
      const nameToSearch = name.replace(/\s/g, '')
      const doubanSearchLink = 'https://www.douban.com/search?q=' + nameToSearch
      axios.get(doubanSearchLink).then(res => {
        const $ = cheerio.load(res.data)
        // 查询所有搜索结果, 看名字和年代是否相符
        let link = ''
        $('div.result').each(function () {
          const linkInDouban = $(this).find('div>div>h3>a').first()
          const nameInDouban = linkInDouban.text().replace(/\s/g, '')
          const subjectCast = $(this).find('span.subject-cast').text()
          if (nameToSearch === nameInDouban && subjectCast && subjectCast.includes(year)) {
            link = linkInDouban.attr('href')
          }
        })
        if (link) {
          resolve(link)
        } else {
          // 如果没找到符合的链接，返回搜索页面
          resolve(doubanSearchLink)
        }
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
   * 获取豆瓣评分
   * @param {*} name 视频名称
   * @param {*} year 视频年份
   * @returns 豆瓣评分
   */
  doubanRate (name, year) {
    return new Promise((resolve, reject) => {
      const nameToSearch = name.replace(/\s/g, '')
      this.doubanLink(nameToSearch, year).then(link => {
        if (link.includes('https://www.douban.com/search')) {
          resolve('暂无评分')
        } else {
          axios.get(link).then(response => {
            const parsedHtml = cheerio.load(response.data)
            const rating = parsedHtml('body').find('#interest_sectl').first().find('strong').first()
            if (rating.text()) {
              resolve(rating.text().replace(/\s/g, ''))
            } else {
              resolve('暂无评分')
            }
          }).catch(err => {
            reject(err)
          })
        }
      }).catch(err => {
        reject(err)
      })
    })
  },
  /**
  * 获取豆瓣相关视频推荐列表
  * @param {*} name 视频名称
  * @param {*} year 视频年份
  * @returns 豆瓣相关视频推荐列表
  */
  doubanRecommendations (name, year) {
    return new Promise((resolve, reject) => {
      const nameToSearch = name.replace(/\s/g, '')
      const recommendations = []
      this.doubanLink(nameToSearch, year).then(link => {
        if (link.includes('https://www.douban.com/search')) {
          resolve(recommendations)
        } else {
          axios.get(link).then(response => {
            const $ = cheerio.load(response.data)
            $('div.recommendations-bd').find('div>dl>dd>a').each(function (index, element) {
              recommendations.push($(element).text())
            })
            resolve(recommendations)
          }).catch(err => {
            reject(err)
          })
        }
      }).catch(err => {
        reject(err)
      })
    })
  },
  getDefaultSites (url) {
    return myvideo.loadConfig(url).then(payload => myvideo.importSites(payload, url))
  },
  resolvePlay (key, marker) {
    return this.getSite(key).then(site => {
      if (!myvideo.isSource(site)) return null
      return myvideo.play(site, marker)
    })
  },
  isPageOver (key, tid, pageNo) {
    return myvideo.isPageOver(key, tid, pageNo)
  },
  proxy () {
    return new Promise((resolve, reject) => {
      setting.find().then(db => {
        if (db && db.proxy && db.proxy.type === 'manual') {
          if (db.proxy.scheme && db.proxy.url && db.proxy.port) {
            const proxyURL = db.proxy.scheme + '://' + db.proxy.url.trim() + ':' + db.proxy.port.trim()
            session.setProxy({ proxyRules: proxyURL }).then(resolve).catch(reject)
            return
          }
        } else {
          session.setProxy({ proxyRules: 'direct://' }).then(resolve).catch(reject)
          return
        }
        resolve()
      })
    })
  }
}

zy.proxy()

export default zy
