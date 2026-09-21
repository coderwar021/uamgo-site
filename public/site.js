for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    const source = document.querySelector(button.dataset.copy)
    if (source === null) return
    try {
      await navigator.clipboard.writeText(source.textContent.trim())
      const previous = button.textContent
      button.textContent = '已复制'
      setTimeout(() => { button.textContent = previous }, 1600)
    } catch {
      getSelection()?.selectAllChildren(source)
    }
  })
}
