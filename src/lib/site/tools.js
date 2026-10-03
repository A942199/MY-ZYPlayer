import { sites, setting } from '../dexie'
import cheerio from 'cheerio'

const { getPlatformApi } = require('../platform/api')
const cms = require('./cms')
const myvideo = require('./myvideo')

const TIMEOUT = 20000

function platformGet (url, options = {}) {
  return getPlatformApi().network.get({
    url,
    timeout: Number(options.timeout) || TIMEOUT,
    maxBytes: options.maxBytes
  })
}

function cmsSearchUrl (api, keyword) {
  const target = new URL(String(api || ''))
  target.searchParams.set('wd', String(keyword || ''))
  return target.toString()
}

function mediaExtension (entry) {
  const text = String(entry || '')
  const raw = text.includes('$') ? text.slice(text.indexOf('$') + 1) : text
  try {
    const match = new URL(raw).pathname.match(/\.([a-z0-9]+)$/i)
    return match ? match[1].toLowerCase() : ''
  } catch (error) {
    const match = raw.split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i)
    return match ? match[1].toLowerCase() : ''
  }
}

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
        const site = res.find(item => key === item.key)
        if (site) resolve(site)
        else reject(Object.assign(new Error('Source not found: ' + key), { code: 'SOURCE_NOT_FOUND' }))
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
        platformGet(url).then(res => {
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
        platformGet(url).then(async res => {
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
        platformGet(url).then(async res => {
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
        const url = cmsSearchUrl(site.api, wd)
        platformGet(url, { timeout: 3000 }).then(res => {
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
        const url = cmsSearchUrl(site.api, wd)
        platformGet(url, { timeout: 3000 }).then(res => {
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
        platformGet(url).then(res => {
          const data = res.data
          const jsondata = cms.parse(data)
          const videoList = cms.asArray(jsondata?.list?.video)[0]
          if (!videoList) return resolve()
          // Parse video lists
          let fullList = []
          let index = 0
          const supportedFormats = ['m3u8', 'mp4']
          const dd = videoList?.dl?.dd
          if (!dd) {
            videoList.fullList = []
            return resolve(videoList)
          }
          const type = Object.prototype.toString.call(dd)
          if (type === '[object Array]') {
            for (const i of dd) {
              i._t = i._t.replace(/\$+/g, '$')
              const ext = [...new Set(i._t.split('#').map(mediaExtension).filter(Boolean))]
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
            platformGet(url).then(res => {
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
      platformGet(doubanSearchLink).then(res => {
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
          platformGet(link).then(response => {
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
          platformGet(link).then(response => {
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
  async resolvePlay (key, marker) {
    const site = await this.getSite(key)
    if (!myvideo.isSource(site)) return null
    const result = await myvideo.play(site, marker)
    if (!result) return null
    const urls = [...new Set((Array.isArray(result.urls) ? result.urls : [result.url]).filter(Boolean))]
    if (urls.length <= 1) return { ...result, url: urls[0] || result.url || '' }
    for (const candidate of urls.slice(0, 4)) {
      try {
        const probe = await getPlatformApi().douban.probe({ url: candidate, headers: result.headers || [], timeout: 2500 })
        if (probe && probe.ok) return { ...result, url: candidate, selectedByProbe: true }
      } catch (error) {}
    }
    return { ...result, url: urls[0] || '' }
  },
  isPageOver (key, tid, pageNo) {
    return myvideo.isPageOver(key, tid, pageNo)
  },
  async proxy () {
    const db = await setting.find()
    if (db && db.proxy && db.proxy.type === 'manual') {
      if (db.proxy.scheme && db.proxy.url && db.proxy.port) {
        const proxyURL = db.proxy.scheme + '://' + db.proxy.url.trim() + ':' + db.proxy.port.trim()
        return getPlatformApi().settings.applyProxy(proxyURL)
      }
      return
    }
    return getPlatformApi().settings.applyProxy('direct://')
  }
}

zy.proxy()

export default zy
