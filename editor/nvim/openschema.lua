-- OpenSchema editor support for Neovim (0.11+).
--
-- Drop this file into your config and `require` it, e.g.:
--   require("openschema")
-- after copying it to ~/.config/nvim/lua/openschema.lua, or source it directly:
--   :luafile /home/moritz/Documents/neoworks/openschema/editor/nvim/openschema.lua
--
-- It assumes editor/nvim/install.sh has already installed the tree-sitter
-- parser and queries. The language server runs straight from the repo via Bun.
--
-- NOTE: This is a plain config module, not a plugin spec. Do NOT drop it in a
-- lazy.nvim `lua/plugins/` directory — that errors with
-- "invalid spec module: ... expected a table". For lazy.nvim, use lazy.lua.

local REPO_ROOT = "/home/moritz/Documents/neoworks/openschema"
local LSP_ENTRY = REPO_ROOT .. "/src/lsp/server.ts"

-- 1. Recognise the file extensions as the `openschema` filetype.
vim.filetype.add({
  extension = {
    schema = "openschema",
    openschema = "openschema",
  },
})

-- 2. Map the filetype to the installed tree-sitter parser of the same name.
vim.treesitter.language.register("openschema", "openschema")

-- 3. Configure the language server (reuses the project's real compiler).
vim.lsp.config.openschema = {
  cmd = { "bun", "run", LSP_ENTRY },
  filetypes = { "openschema" },
  root_markers = { "package.json", ".git" },
}
vim.lsp.enable("openschema")

-- 4. Start tree-sitter highlighting/folding when an OpenSchema buffer opens.
vim.api.nvim_create_autocmd("FileType", {
  pattern = "openschema",
  callback = function()
    pcall(vim.treesitter.start)
    vim.wo.foldmethod = "expr"
    vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
    vim.wo.foldenable = false
  end,
})
