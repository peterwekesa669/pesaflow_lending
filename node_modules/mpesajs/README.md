<h1 align="center">MpesaJS: Node.js SDK for Integration with M-Pesa API</h1>

<p align="center">
  <img src="https://www.brandtimes.com.ng/wp-content/uploads/2024/03/M-PESA_Vector_Logo-01-1.png" alt="MpesaJS Logo" width="200" height="auto">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mpesajs"><img src="https://img.shields.io/npm/v/mpesajs.svg" alt="npm version"></a>
  <a href="https://docs-mpesajs.vercel.app"><img src="https://img.shields.io/badge/docs-available-brightgreen.svg" alt="Documentation"></a>
</p>

A powerful Node.js SDK for seamless integration with M-Pesa payment gateway, providing easy-to-use methods for handling transactions, payments, and API interactions.

## 📋 Table of Contents

- [Installation](#installation)
- [Features](#features)
- [CLI Usage](#cli-usage)
- [Usage Examples](#usage-examples)
  - [Authentication](#authentication)
  - [Register URL](#register-url)
  - [Payout](#payout)
  - [STK Push](#stk-push)
- [Error Handling](#error-handling)
- [Documentation](#documentation) 

## Installation

```bash 
npm install mpesajs
```

## Features

- 🛠️ **CLI Support**: Command-line interface for common operations
- 📦 **TypeScript Support**: Full TypeScript definitions included
- 🔍 **Validation**: Request validation to prevent common errors
- 🐞 **Error Handling**: Detailed error messages for debugging
- ⚡ **Promise-based API**: Modern async/await compatible interfaces
- 🔐 **Authentication**: Secure Generation of Access Token 
- 💳 **STK Push**: Initiate STK Push Payment with less code
- 🔄 **Register URL**: Register Validation and Confirmation URLs for C2B transactions   
- 💸 **Payout**: Initiate Business-to-Customer (B2C) payments with less code

## CLI Usage

MpesaJS comes with a built-in CLI tool to help you quickly set up your environment variables. The CLI supports both test and live environments.

### Basic Commands

```bash
# Initialize test environment
npx mpesajs init-test

# Initialize live environment
npx mpesajs init-live

# Show help menu
npx mpesajs --help

# Show version
npx mpesajs --version
```

### Environment File Options

By default, the CLI creates a separate `.env.mpesajs` file to keep SDK settings isolated. You can use the `--default-env` flag to write to the standard `.env` file instead:

```bash
# Write to default .env file
npx mpesajs init-test --default-env
```

### What Gets Generated?

Running the initialization commands will create an environment file with pre-configured variables:

- Test environment includes sandbox credentials for quick testing
- Live environment includes placeholders for your production credentials
- SDK-specific configuration for rate limiting and retries

Example output after running `npx mpesajs init-test`:

```env
MPESA_CONSUMER_KEY=your_test_key
MPESA_CONSUMER_SECRET=your_test_secret
MPESA_SANDBOX=true
MPESA_BUSINESS_SHORTCODE=your_shortcode
# ... and more essential variables

# SDK Configuration
MPESAJS_MAX_RETRIES=3
MPESAJS_INITIAL_DELAY_MS=1000
MPESAJS_MAX_DELAY_MS=10000
# ... and more SDK settings
```

⚠️ Remember to update the generated environment variables with your actual credentials before using the SDK.


## Usage Examples

MpesaJS SDK provides interfaces that allow you to interact with the M-Pesa API with minimal code by leveraging the use of environment variables that are generated when you run the CLI. Below are some examples demonstrating how to use the SDK for common tasks.

### Authentication

Here's how you can generate an authentication token using the `Auth` class:

```typescript
import { Auth } from 'mpesajs';

async function generateToken() {
    const auth = new Auth();
    const { token, expiresIn } = await auth.generateToken();
    console.log('Token:', token, 'Expires in:', expiresIn);
}

generateToken();
```

### Register URL

Register your confirmation and validation URLs with M-Pesa:

```typescript
import { RegisterUrl } from 'mpesajs';

async function registerUrls() {
  const register = new RegisterUrl();
    const response = await register.register();
    console.log('URLs registered:', response);
}

registerUrls();
```

### Payout

Initiate a payout using the `Payout` class:

```typescript
import { Auth, Payout } from 'mpesajs';

async function initiatePayout() {
  const auth = new Auth();
    const payout = new Payout(auth);
    const response = await payout.send(100, 'Payment for services');
    console.log('Payout response:', response);
}

initiatePayout();
```

### STK Push

Send an STK Push request to a customer's phone to initiate M-Pesa payments. The SDK provides robust validation, error handling, and rate limiting for STK Push requests.

```typescript
import { Auth, StkPush } from 'mpesajs';

async function sendStkPush() {
  const auth = new Auth();
  const stkPush = new StkPush(auth);
  
  try {
    const response = await stkPush.sendStkPush(
      '174379',                              // Business Shortcode
      'your-passkey',                        // Passkey from M-Pesa
      100,                                   // Amount in ETB
      '251700000000',                        // Customer Phone Number
      'https://callback.url/endpoint',       // HTTPS Callback URL
      'INV123',                              // Account Reference (max 12 chars)
      'Payment'                              // Transaction Description (max 13 chars)
    );
    
    console.log('STK Push Response:', {
      MerchantRequestID: response.MerchantRequestID,
      CheckoutRequestID: response.CheckoutRequestID,
      ResponseDescription: response.ResponseDescription
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      // Handle validation errors (phone number, amount, URLs, etc.)
      console.error('Validation failed:', error.message);
    } else if (error instanceof StkPushError) {
      // Handle M-Pesa API specific errors
      console.error('STK Push failed:', error.message);
    } else if (error instanceof NetworkError) {
      // Handle network connectivity issues
      console.error('Network error:', error.message);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

sendStkPush();
```

  ## Documentation
  
  For complete documentation, visit [docs-mpesajs.vercel.app](https://docs-mpesajs.vercel.app)

## Error Handling

MpesaJS SDK provides robust error handling to help you manage and debug issues effectively. The SDK defines several custom error classes to represent different types of errors that can occur during API interactions.

### Common Error Classes

- **AuthenticationError**: Thrown when there is an issue with authentication, such as invalid credentials.
- **NetworkError**: Represents network-related issues, such as connectivity problems.
- **ValidationError**: Used for input validation errors, indicating that provided data does not meet required criteria.
- **RegisterUrlError**: Specific to errors encountered during URL registration with M-Pesa.
- **PayoutError**: Represents errors that occur during payout operations.
- **StkPushError**: Used for errors related to STK Push transactions.
- **MpesaError**: A general error class for other M-Pesa related issues.

### Error Handling Example

Here's an example of how you can handle errors when initiating a payout:

```typescript
import { Auth, Payout, PayoutError, NetworkError, ValidationError, AuthenticationError } from 'mpesajs';

async function initiatePayout() {
    try {
        const auth = new Auth();
        const payout = new Payout(auth);
        const response = await payout.send(100, 'Payment for services');
        console.log('Payout response:', response);
    } catch (error) {
        if (error instanceof AuthenticationError) {
            console.error('Authentication failed:', error.message);
        } else if (error instanceof ValidationError) {
            console.error('Validation error:', error.message);
        } else if (error instanceof PayoutError) {
            console.error('Payout error:', error.message);
        } else if (error instanceof NetworkError) {
            console.error('Network error:', error.message);
        } else {
            console.error('An unexpected error occurred:', error);
        }
    }
}

initiatePayout();
```

This example demonstrates how to catch and handle different types of errors, providing specific messages for each error type to aid in debugging.

<p align="center">
  Made with ❤️ by <a href="https://github.com/kiflomm">Kiflom Berihu</a>
</p> 
