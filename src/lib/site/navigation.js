'use strict'

function normalizeCategoryId (value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function findCategoryByTid (categories, tid) {
  const wanted = normalizeCategoryId(tid)
  if (!wanted) return null
  return (Array.isArray(categories) ? categories : []).find(category => normalizeCategoryId(category && category.tid) === wanted) || null
}

function formatCategoryOptionLabel (category, options = {}) {
  const name = String(category && category.name || '').trim()
  if (!options.selected) return name
  const visibleCount = Math.max(0, Number(options.visibleCount) || 0)
  if (options.totalKnown) {
    const total = Math.max(0, Number(options.totalCount) || 0)
    if (total > 0 && total >= visibleCount) return name + '    ' + visibleCount + '/' + total
  }
  return name + '    ' + visibleCount
}

module.exports = {
  normalizeCategoryId,
  findCategoryByTid,
  formatCategoryOptionLabel
}
