terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.62"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is intentionally not configured here — every team's bucket/table
  # names differ. Uncomment and fill in after running `scripts/bootstrap-state.sh`
  # (or create the bucket/table by hand), then `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket         = "forge-freight-tfstate-<account-id>"
  #   key            = "forge-freight/terraform.tfstate"
  #   region         = "af-south-1"
  #   dynamodb_table = "forge-freight-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "forge-freight"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
