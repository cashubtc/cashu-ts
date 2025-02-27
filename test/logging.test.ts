import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import { setVerbose, logWarning } from '../src/utils.js';
import { WSConnection } from '../src/WSConnection.js';
import { Server, WebSocket } from 'mock-socket';
import { injectWebSocketImpl } from '../src/ws.js';
import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

injectWebSocketImpl(WebSocket);

describe('Verbose Logging Tests', () => {
  let consoleLogMock;
  let consoleWarnMock;
  let consoleErrorMock;

  beforeEach(() => {
    // Setup console mocks
    consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    consoleLogMock.mockRestore();
    consoleWarnMock.mockRestore();
    consoleErrorMock.mockRestore();
  });

  afterAll(() => {
    // Ensure console methods are restored
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  test('CashuWallet respects verbose flag', () => {
    // Create wallet with verbose disabled
    const mintUrl = 'https://example.com';
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint, { verbose: false });
    
    // Call a method that would log
    wallet['log']('Test message');
    
    // Verify no logging occurred
    expect(consoleLogMock).not.toHaveBeenCalled();
    
    // Create wallet with verbose enabled
    const verboseMint = new CashuMint(mintUrl, undefined, { verbose: true });
    const verboseWallet = new CashuWallet(verboseMint, { verbose: true });
    
    // Call a method that would log
    verboseWallet['log']('Test message');
    
    // Verify logging occurred
    expect(consoleLogMock).toHaveBeenCalledWith('Test message');
  });

  test('CashuMint respects verbose flag', () => {
    // Create mint with verbose disabled
    const mintUrl = 'https://example.com';
    const mint = new CashuMint(mintUrl);
    
    // Call a method that would log
    mint['log']('Test message');
    
    // Verify no logging occurred
    expect(consoleLogMock).not.toHaveBeenCalled();
    
    // Create mint with verbose enabled
    const verboseMint = new CashuMint(mintUrl, undefined, { verbose: true });
    
    // Call a method that would log
    verboseMint['log']('Test message');
    
    // Verify logging occurred
    expect(consoleLogMock).toHaveBeenCalledWith('Test message');
  });

  test('WSConnection respects verbose flag', () => {
    // Create connection with verbose disabled
    const wsUrl = 'ws://localhost:3338/v1/ws';
    const connection = new WSConnection(wsUrl);
    
    // Call a method that would log
    connection['log']('Test message');
    
    // Verify no logging occurred
    expect(consoleLogMock).not.toHaveBeenCalled();
    
    // Create connection with verbose enabled
    const verboseConnection = new WSConnection(wsUrl, { verbose: true });
    
    // Call a method that would log
    verboseConnection['log']('Test message');
    
    // Verify logging occurred
    expect(consoleLogMock).toHaveBeenCalledWith('Test message');
  });

  test('Global utils logging functions respect verbose flag', () => {
    // Set verbose to false
    setVerbose(false);
    
    // Call warning function
    logWarning('Test warning');
    
    // Verify no logging occurred
    expect(consoleWarnMock).not.toHaveBeenCalled();
    
    // Set verbose to true
    setVerbose(true);
    
    // Call warning function
    logWarning('Test warning');
    
    // Verify logging occurred
    expect(consoleWarnMock).toHaveBeenCalledWith('Test warning');
    
    // Reset verbose to false for other tests
    setVerbose(false);
  });

  test('Verbose flag is passed correctly between components', () => {
    const mintUrl = 'https://example.com';
    const wsUrl = 'ws://localhost:3338/v1/ws';
    
    // Create a mock server
    const server = new Server(wsUrl, { mock: false });
    
    // Create mint with verbose enabled
    const verboseMint = new CashuMint(mintUrl, undefined, { verbose: true });
    
    // Create a wallet with the verbose mint and explicitly set verbose
    const wallet = new CashuWallet(verboseMint, { verbose: true });
    
    // Verify wallet has verbose setting enabled
    expect(wallet['_verbose']).toBe(true);
    
    // Clean up
    server.stop();
  });
}); 