import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom does not include TextEncoder/TextDecoder; provide Node.js implementations.
global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;
