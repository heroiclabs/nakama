# Copyright 2017 The Nakama Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# An install script for Nakama with Homebrew.

require "language/go"

class Nakama < Formula
  desc "Distributed server for social and realtime games and apps."
  homepage "https://heroiclabs.com"
  url "https://github.com/heroiclabs/nakama/releases/download/v0.11.0/nakama-0.11.0-darwin-amd64.tar.gz"
  sha256 "c9b83743ef42f095d7483b4a32e0b19c68f457a6aec417218efb125bf1152886"
  version "0.11.0"

  head "https://github.com/heroiclabs/nakama.git"

  if build.head?
    depends_on "glide" => :build
    depends_on "go" => :build
    depends_on "node" => :build
    depends_on "protobuf" => :build
  end

  def install
    if build.head?
      ENV["GOPATH"] = buildpath
      ENV["GOBIN"]  = buildpath/"bin"
      ENV["GLIDE_HOME"] = HOMEBREW_CACHE/"glide_home/#{name}"

      (buildpath/"src/github.com/heroiclabs/nakama").install buildpath.children
      cd "src/github.com/heroiclabs/nakama" do
        system "glide", "install"
        system "make", "gettools", "nakama"
        bin.install "build/dev/nakama" => "nakama"
      end
    else
      bin.install "nakama"
      prefix.install "README.md", "CHANGELOG.md", "LICENSE"
    end
  end

  def caveats
    <<-EOS.undent
    You will need to install cockroachdb as the database.
    You can start a nakama server with:
        nakama
    EOS
  end

  def test
    system "#{bin}/nakama", "--version"
  end
end
