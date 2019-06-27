# Build Automation with Packer

[Packer](https://www.packer.io/intro/index.html) is a tool for creating images from a single source configuration. Using this Packer template reduces the entire process of creating, configuring, validating, and snapshotting a build Droplet to a single command:

```
packer build marketplace-image.json
```

This Packer template is configured to create a snapshot with Nakama and CockroachDB.
## Usage

To get started, you'll need to [install Packer](https://www.packer.io/intro/getting-started/install.html) and [create a DigitalOcean personal access token](https://www.digitalocean.com/docs/api/create-personal-access-token/) and set it to the `DIGITALOCEAN_API_TOKEN` environment variable. Running `packer build marketplace-image.json` without any other modifications will create a build Droplet configured with Nakama & CockroachDB, clean and verify it, then power it down and snapshot it.

> ⚠️ The image validation script in `scripts/99-img_check.sh` is copied from the [top-level `scripts` directory](../scripts) in the [DigitalOcean Marketplace Partnners repository](https://github.com/digitalocean/marketplace-partners). The top-level location is the script's canonical source, so make sure you're using the latest version from there.

This Packer template uses binaries for both Nakama and CockroachDB. The URL for each binary is set via variables at the top of the template.

## Configuration Details

By using [Packer's DigitalOcean Builder](https://www.packer.io/docs/builders/digitalocean.html) to integrate with the [DigitalOcean API](https://developers.digitalocean.com/), this template fully automates Marketplace image creation.

This template uses Packer's [file provisioner](https://www.packer.io/docs/provisioners/file.html) to upload complete directories to the Droplet. The contents of `files/var/` will be uploaded to `/var/`. Likewise, the contents of `files/etc/` will be uploaded to `/etc/`. One important thing to note about the file provisioner, from Packer's docs:

> The destination directory must already exist. If you need to create it, use a shell provisioner just prior to the file provisioner in order to create the directory. If the destination directory does not exist, the file provisioner may succeed, but it will have undefined results.

This template also uses Packer's [shell provisioner](https://www.packer.io/docs/provisioners/shell.html) to run scripts from the `/scripts` directory and install APT packages using an inline task.

Learn more about using Packer in [the official Packer documentation](https://www.packer.io/docs/index.html).

