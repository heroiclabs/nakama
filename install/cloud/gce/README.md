## Run Nakama with Google Compute Engine

These instructions show how to deploy Nakama and CockroachDB in Compute Engine on Google Cloud. The provisioner scripts are written in [Terraform](https://www.terraform.io) and automate the setup and deployment of the server resources.

The scripts define variables which must be configured for your deployment. These variables should be configured in a file you'd create called `myproject.tfvars`:

```
gce_project_name = "myproject"
gce_region = "us-east1"
gce_region_zone = "us-east1-b"
gce_ssh_user = "root"
gce_ssh_public_key_file = "your/id_rsa.pub"
gce_ssh_private_key_file = "your/id_rsa"
app_nakama_version = "0.11.2"
app_cockroachdb_version = "beta-20170209"
app_machine_type = "g1-small"
```

You'll also need an `account.json` used to describe your account credentials downloaded from Google Cloud Console. Have a look at the [configuration reference](https://www.terraform.io/docs/providers/google/index.html#configuration-reference) in Terraform's provider docs for more info.

If you need any help or have any questions join our [community channel](https://gitter.im/heroiclabs/nakama) and speak to an engineer or [open an issue](https://github.com/heroiclabs/nakama).

### Full workflow

To provision and deploy a minimal cluster:

1. Create a file named `myproject.tfvars` with the content above.

   Update `"gce_project_name"`, `"gce_ssh_public_key_file"`, and `"gce_ssh_private_key_file"` with your settings.

2. Set the rest of the variables to the values you'd like to use to provision resources in Google Cloud. For example you might want to use an "n1-standard-1" instance rather than "g1-small".

3. You can inspect the resources which will be provisioned:

   ```
   terraform plan --var-file myproject.tfvars
   ```

4. You can apply the resources which will be provisioned:

   ```
   terraform apply --var-file myproject.tfvars
   ```

5. When complete it will include output which shows the public IP of your provisioned Nakama and CockroachDB instance:

   ```
   Outputs:

   instance_ips = 10.100.40.100
   public_ip = 10.100.39.110
   ```

6. The `instance_ips` contain the list of IP addresses which can be reached via a [Nakama client](https://heroiclabs.com/docs/clients/).
