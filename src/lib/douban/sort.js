'use strict'

function numericRate (rate) {
  const text = String(rate == null ? '' : rate).trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : null
}

function sortSubjectsForDisplay (rows, sort) {
  const list = Array.isArray(rows) ? rows.slice() : []
  if (sort !== 'rank') return list

  return list
    .map((item, index) => ({ item, index, rate: numericRate(item && item.rate) }))
    .sort((a, b) => {
      if (a.rate == null && b.rate == null) return a.index - b.index
      if (a.rate == null) return 1
      if (b.rate == null) return -1
      if (a.rate !== b.rate) return b.rate - a.rate
      return a.index - b.index
    })
    .map(row => row.item)
}

module.exports = { sortSubjectsForDisplay }
