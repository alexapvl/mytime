class Mytime < Formula
  desc "Terminal task manager with Google and Apple Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  version "0.4.3"
  license "MIT"

  head "https://github.com/alexapvl/mytime.git", branch: "main"

  depends_on macos: :sonoma
  depends_on "node@20"

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20. See scripts/build-macos-pack.sh.
  on_macos do
    on_arm do
      url "https://github.com/alexapvl/mytime/releases/download/v0.4.3/mytime-0.4.3-macos-arm64.tar.gz"
      sha256 "996e6b8a0ffcde68e7e55feab1c76c90302eb081b875b9a07aa8bb4f86e004a3"
    end

    on_intel do
      url "https://github.com/alexapvl/mytime/releases/download/v0.4.3/mytime-0.4.3-macos-x86_64.tar.gz"
      sha256 "92af1062f1380ab2c87b06231a639e633560e32845598da2113851bdda230b72"
    end
  end

  def install
    if build.head?
      ENV.prepend_path "PATH", formula_opt_bin("node@20")
      system "npm", "install", *std_npm_args(prefix: false, ignore_scripts: false)
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
    else
      libexec.install "dist", "node_modules"
      cd libexec do
        system formula_opt_bin("node@20")/"npm", "rebuild", "better-sqlite3"
      end
    end

    (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{formula_opt_bin("node@20")}:$PATH"
  end

  def caveats
    <<~EOS
      For AI agent support, install the recommended mytime skill:
        npx skills add https://github.com/alexapvl/mytime --skill mytime -g

      Then print the agent onboarding prompt with:
        mytime setup --agent-onboarding-prompt
    EOS
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
