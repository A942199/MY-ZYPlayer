const getSite = (key) => {
  for (const i of sites) {
    if (key === i.key) {
      return i
    }
  }
}

const sites = require('./iniData/Sites.json')
const iniSetting = require('./iniData/iniSetting.json')
const localKey = require('./iniData/localKey.json')
export {
  sites,
  iniSetting,
  localKey,
  getSite
}
