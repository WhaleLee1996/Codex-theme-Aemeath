"""Read PE packaging metadata and refresh the local copy's ASAR header record.

This changes only the 64-byte header digest in the existing Integrity resource.
It does not modify executable code, runtime fuses, or the installed application.
"""
import hashlib
import json
import struct


def asar_header_digest(archive):
    with archive.open('rb') as stream:
        marker, header_size, payload_size, json_size = struct.unpack('<4I', stream.read(16))
        if marker != 4 or payload_size + 4 != header_size or json_size > 64 * 1024 * 1024:
            raise ValueError('Unsupported ASAR header')
        header = stream.read(json_size)
        if len(header) != json_size:
            raise ValueError('Truncated ASAR header')
        return hashlib.sha256(header).hexdigest()


def integrity_resource(data):
    if data[:2] != b'MZ':
        raise ValueError('Expected a PE executable')
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[pe:pe+4] != b'PE\0\0':
        raise ValueError('Invalid PE signature')
    sections = struct.unpack_from('<H', data, pe+6)[0]
    optional_size = struct.unpack_from('<H', data, pe+20)[0]
    optional = pe + 24
    magic = struct.unpack_from('<H', data, optional)[0]
    if magic not in (0x10b, 0x20b):
        raise ValueError('Unsupported PE optional header')
    directory = optional + (112 if magic == 0x20b else 96)
    resource_rva, resource_size = struct.unpack_from('<II', data, directory+16)
    section_table = optional + optional_size

    def offset(rva, size=1):
        for index in range(sections):
            virtual_size, address, raw_size, raw_offset = struct.unpack_from('<IIII', data, section_table+index*40+8)
            delta = rva-address
            if 0 <= delta and delta+size <= raw_size and delta < max(raw_size, virtual_size):
                result = raw_offset+delta
                if result+size <= len(data):
                    return result
        raise ValueError('Resource address is outside a PE section')

    base = offset(resource_rva, resource_size)

    def resource_name(raw):
        if not raw & 0x80000000:
            return raw
        position = base+(raw & 0x7fffffff)
        length = struct.unpack_from('<H', data, position)[0]
        return data[position+2:position+2+length*2].decode('utf-16-le')

    def walk(relative, names=()):
        if len(names) > 3 or relative+16 > resource_size:
            raise ValueError('Invalid resource directory')
        named, ids = struct.unpack_from('<HH', data, base+relative+12)
        if relative+16+8*(named+ids) > resource_size:
            raise ValueError('Resource directory exceeds its section')
        for index in range(named+ids):
            name, child = struct.unpack_from('<II', data, base+relative+16+index*8)
            labels = (*names, resource_name(name))
            if child & 0x80000000:
                yield from walk(child & 0x7fffffff, labels)
            else:
                if child+16 > resource_size:
                    raise ValueError('Resource entry exceeds its section')
                rva, size = struct.unpack_from('<II', data, base+child)
                yield labels, offset(rva, size), size

    resources = [(start, size) for labels, start, size in walk(0)
                 if len(labels) == 3 and str(labels[0]).lower() == 'integrity'
                 and str(labels[1]).lower() == 'electronasar']
    if len(resources) != 1:
        raise ValueError('Expected one ElectronAsar Integrity resource')
    start, size = resources[0]
    raw = data[start:start+size]
    records = json.loads(raw.rstrip(b'\0'))
    if not isinstance(records, list) or len(records) != 1:
        raise ValueError('Unknown ASAR integrity resource shape')
    record = records[0]
    if record.get('file', '').replace('/', '\\') != 'resources\\app.asar' or record.get('alg', '').lower() != 'sha256':
        raise ValueError('Unexpected integrity resource target')
    value = record.get('value', '')
    if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Invalid integrity digest')
    needle = value.encode('ascii')
    if raw.count(needle) != 1:
        raise ValueError('Ambiguous integrity digest location')
    return {'digest': value, 'offset': start+raw.index(needle)}


def packaged_executable(source_bytes, source_digest, target_digest):
    resource = integrity_resource(source_bytes)
    if resource['digest'] != source_digest:
        raise ValueError('Original executable and ASAR do not match')
    if len(target_digest) != 64 or any(c not in '0123456789abcdef' for c in target_digest):
        raise ValueError('Invalid target digest')
    start = resource['offset']
    updated = source_bytes[:start] + target_digest.encode('ascii') + source_bytes[start+64:]
    if integrity_resource(updated)['digest'] != target_digest:
        raise ValueError('Packaging integrity update failed')
    return updated, {'resource': 'Integrity/ElectronAsar', 'sourceHeaderSha256': source_digest,
                     'stagedHeaderSha256': target_digest, 'modifiedByteRange': [start, start+64],
                     'onlyPackagingDigestChanged': True, 'originalPublisherSignaturePreserved': False}


def read_fuses(app):
    sentinel = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
    result = []
    for name in ('ChatGPT.exe', 'chrome.dll'):
        binary = app/name
        if not binary.is_file():
            continue
        data = binary.read_bytes()
        position = data.find(sentinel)
        if position < 0:
            continue
        if data.count(sentinel) != 1:
            raise ValueError('Ambiguous runtime fuse location')
        position += len(sentinel)
        version, length = data[position:position+2]
        flags = data[position+2:position+2+length]
        if version != 1 or len(flags) != length or length < 6:
            raise ValueError('Unsupported runtime fuse format')
        result.append({'file': name, 'version': version, 'flags': flags.decode('ascii'),
                       'integrityEnabled': flags[4] == ord('1'), 'modified': False})
    if not result:
        raise ValueError('Runtime integrity configuration could not be located')
    return {'present': True, 'modified': False, 'binaries': result}
