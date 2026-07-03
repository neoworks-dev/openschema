-- lazy.nvim spec for OpenSchema editor support.
--
-- Put THIS file in your `lua/plugins/` directory (e.g. lua/plugins/openschema.lua).
-- Unlike editor/nvim/openschema.lua (a plain config module for `require`/`luafile`),
-- this returns a spec table, which is what lazy.nvim's plugin importer expects.
--
-- It is a local, no-download "plugin": `dir` points at this repo so lazy has a
-- source but fetches nothing. Run editor/nvim/install.sh once to install the
-- tree-sitter parser and queries.

local REPO_ROOT = "/home/moritz/Documents/neoworks/openschema"

return {
  name = "openschema",
  dir = REPO_ROOT .. "/editor/nvim",
  lazy = false,
  priority = 100,
  config = function()
    -- 1. Recognise the file extensions as the `openschema` filetype.
    vim.filetype.add({
      extension = {
        schema = "openschema",
        openschema = "openschema",
      },
    })

    -- 2. Map the filetype to the installed tree-sitter parser of the same name.
    vim.treesitter.language.register("openschema", "openschema")

    -- 3. Configure the language server (Neovim 0.11+).
    if vim.lsp.config ~= nil and vim.lsp.enable ~= nil then
      vim.lsp.config.openschema = {
        cmd = { "bun", "run", REPO_ROOT .. "/src/lsp/server.ts" },
        filetypes = { "openschema" },
        root_markers = { "package.json", ".git" },
      }
      vim.lsp.enable("openschema")
    else
      -- Neovim 0.10 or earlier: start the server per buffer.
      vim.api.nvim_create_autocmd("FileType", {
        pattern = "openschema",
        callback = function(args)
          vim.lsp.start({
            name = "openschema",
            cmd = { "bun", "run", REPO_ROOT .. "/src/lsp/server.ts" },
            root_dir = vim.fs.root(args.buf, { "package.json", ".git" }),
          })
        end,
      })
    end

    -- 4. Turn on tree-sitter highlighting/folding for OpenSchema buffers.
    vim.api.nvim_create_autocmd("FileType", {
      pattern = "openschema",
      callback = function()
        pcall(vim.treesitter.start)
        vim.wo.foldmethod = "expr"
        vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
        vim.wo.foldenable = false
      end,
    })
  end,
}
