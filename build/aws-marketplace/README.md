# Release process

The images for AWS Marketplace are tagged the same way the Nakama itself is tagged.
Each new tag of Nakama triggers a build for the same tag of the AWS Marketplace image.

## Marketplace Product Version

When a new Marketplace image is published by the cloudbuild it must be registered manually
in the Marketplace product. This is done by a Change Request - Add new version. The contents
of the version specification can be copied from pervious available version and the tag numbers
changed in version description and launch link.

## Cloud Build Variables

The following variables are present in the cloudbuild environment:

    _MAP_ECR_REPOSITORY
    _AWS_ACCESS_KEY_ID
    _AWS_SECRET_ACCESS_KEY
    _AWS_DEFAULT_REGION
